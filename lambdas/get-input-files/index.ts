import { S3, paginateListObjectsV2 } from "@aws-sdk/client-s3";
import { Handler } from "aws-lambda";
import { Array, Literal, Number, Record, String, Union } from "runtypes";
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import assert from "assert";
import path from "path";

const s3 = new S3({});
const dynamo = DynamoDBDocument.from(new DynamoDB({}));

const { TABLE_NAME } = process.env;

const Job = Record({
  id: String,
  status: Union(Literal("PENDING")),
  input: Record({
    bucket: String,
    key: String,
  }),
  output: Array(
    Record({
      bucket: String,
      key: String,
      bitrate: Number,
      container: Union(Literal("mp3"), Literal("mp4"), Literal("webm")),
      codec: Union(Literal("mp3"), Literal("aac"), Literal("opus")),
    }).withConstraint((x) => {
      switch ([x.container, x.codec].join(",")) {
        case "mp3,mp3":
        case "mp4,aac":
        case "webm,opus":
          return true;
        default:
          return `The container "${x.container}" cannot be used with the codec "${x.codec}".`;
      }
    })
  ),
});

export const handler: Handler = async (event) => {
  assert(TABLE_NAME, "Missing TABLE_NAME");
  const result = Job.validate(event);
  if (!result.success) {
    console.error(
      `Record failed validation: ${result.message} (Key: ${result.key}) (Event: ${event})`
    );
    throw new Error(
      `Record failed validation: ${result.message} (Key: ${result.key}) (Event: ${event})`
    );
  }
  const job = result.value;
  const keys = [];
  const { bucket: Bucket, key: Prefix } = job.input;
  for await (const output of paginateListObjectsV2(
    { client: s3 },
    { Bucket, Prefix }
  )) {
    for (const key of output.Contents?.map((x) => x.Key!) || []) {
      if (key.replace(`${Prefix}/`, "").includes("/")) {
        // TODO passthrough?
      } else {
        keys.push(key);
      }
    }
  }

  const files = [];
  for (const key of keys) {
    for (const output of job.output) {
      const basename = path.parse(key).name;
      const ext = {
        mp3: "mp3",
        mp4: "m4a",
        webm: "webm",
      }[output.container];
      const outputKey = `${output.key}/${basename}.${ext}`;
      files.push({
        status: "PENDING",
        input: {
          bucket: job.input.bucket,
          key,
        },
        output: {
          ...output,
          key: outputKey,
        },
      });
    }
  }

  await dynamo.update({
    TableName: TABLE_NAME,
    Key: { id: job.id },
    ConditionExpression: "attribute_exists(id)",
    UpdateExpression: "SET #remaining = :remaining, #files = :files",
    ExpressionAttributeNames: {
      "#files": "files",
      "#remaining": "remaining",
    },
    ExpressionAttributeValues: {
      ":files": files,
      ":remaining": files.length,
    },
  });

  const chunks = [];
  const fileJobs = files.map((x, i) => ({ index: i, id: job.id, ...x }));
  while (fileJobs.length > 0) {
    chunks.push(fileJobs.splice(0, 25));
  }
  return chunks;
};
