import { S3, paginateListObjectsV2 } from "@aws-sdk/client-s3";
import { Handler } from "aws-lambda";
import { Array, Literal, Number, Record, String, Union } from "runtypes";
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import assert from "assert";
import path from "path";

const s3 = new S3({});
const dynamo = DynamoDBDocument.from(new DynamoDB({ maxAttempts: 64 }));

const { TABLE_NAME } = process.env;

const Job = Record({
  chunk: Array(Record({
    key: String,
    index: Number,
    format: String
  })),
  id: String,
  status: Union(Literal("PENDING")),
  keyscount: Number,
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
  const keyscount = job.keyscount ;

  assert(job.chunk.length > 0, "Empty chunk");

  const files = [];
  for (const { key, index, format } of job.chunk) {
    const formatInfo = format.split("|");
    let out_key = formatInfo[0]
    let output = {"container": formatInfo[1], "codec": formatInfo[2], "bitrate": formatInfo[3] }
      const basename = path.parse(key).name;
      const ext = {
        mp3: "mp3",
        mp4: "m4a",
        webm: "webm",
      }[output.container];
      const outputKey = `${out_key}/${basename}.${ext}`;

      files.push({
        index,
        status: "PENDING",
        input: {
          bucket: job.input.bucket,
          key,
        },
        output: {
          bucket: job.output[0],
          key:  outputKey,
          container: formatInfo[1],
          codec: formatInfo[2],
          bitrate:  formatInfo[3],
        },
      });
    //}
  }

  for (const file of files) {
    await dynamo.update({
      TableName: TABLE_NAME,
      Key: { id: job.id },
      ConditionExpression: "attribute_exists(id)",
      UpdateExpression: `SET #files[${file.index}] = :file`,
      ExpressionAttributeNames: {
        "#files": "files",
      },
      ExpressionAttributeValues: {
        ":file": file,
      },
    });
  }

  return files.map((x) => ({ id: job.id, ...x }));
};
