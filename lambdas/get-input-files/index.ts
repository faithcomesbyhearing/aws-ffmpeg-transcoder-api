import { S3, paginateListObjectsV2 } from "@aws-sdk/client-s3";
import { Handler } from "aws-lambda";
import { Array, Literal, Number, Record, String, Union } from "runtypes";
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import assert from "assert";

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
  for await (const output of paginateListObjectsV2({ client: s3 }, { Bucket, Prefix })) {
    for (const key of output.Contents?.map((x) => x.Key!) || []) {
      if (!key.replace(`${Prefix}/`, "").includes("/") && !key.endsWith(".zip")) {
        keys.push(key);
      }
    }
  }

  assert(keys.length > 0, "No input files found");

  await dynamo.update({
    TableName: TABLE_NAME,
    Key: { id: job.id },
    ConditionExpression: "attribute_exists(id)",
    UpdateExpression: "SET #remaining = :remaining, #files = :files",
    ExpressionAttributeNames: {
      "#remaining": "remaining",
      "#files": "files",
    },
    ExpressionAttributeValues: {
      ":remaining": keys.length * job.output.length,
      ":files": keys.map((_, index) => ({ index })),
    },
  });

  const chunks = [];
  // const indexed = keys.map((key, index) => ({ key, index, foo }));
  const indexed = [];
  const keyslen = keys.length;
  const outputLen = job.output.length;
  const foo = keyslen*outputLen;  

  console.log(`lambda getInputFiles. outputLen: ${outputLen}. keyslen: ${keyslen}. foo: ${foo}`)
  for (let i = 0; i < outputLen; i++) {
    for (let j= 0; j<keyslen; j++) {
      let key = keys[j]
      let index = j + (i*keyslen)   
      indexed[index] = {key, index, foo}
      console.log(`  trace... index : ${index}. contents: ${indexed[index]}`)
    }
  } 
  while (indexed.length > 0) {
    chunks.push(indexed.splice(0, 10));
  }
  return chunks;
};
