import { S3, paginateListObjectsV2 } from "@aws-sdk/client-s3";
import { Handler } from "aws-lambda";
import { Array, Literal, Number, Optional, Record, String, Union } from "runtypes";
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import assert from "assert";

const isLocal = process.env.NODE_ENV === 'local';

const s3 = new S3({});
const dynamo = DynamoDBDocument.from(new DynamoDB({}));

const { TABLE_NAME } = process.env;

const Job = Record({
  id: String,
  status: Union(Literal("PENDING")),
  keyscount: Optional(Number),
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
      `Record failed validation: ${result.message} (Event: ${JSON.stringify(event)})`
    );
    throw new Error(
      `Record failed validation: ${result.message} (Event: ${JSON.stringify(event)})`
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
  job.keyscount = keys.length

  // fanout
  let outputLen = job.output.length
  let keyslen = job.keyscount
  let fanoutTotal = keyslen*outputLen; 
  let output = job.output 

  const fanout = [];
  let index = 0 ;
  for (let j= 0; j<keyslen; j++) {
    let key = keys[j]
    for (let i = 0; i < outputLen; i++) {
      let format = [output[i].key, output[i].container,  output[i].codec,  output[i].bitrate, output[i].bucket].join("|")
      fanout[index] = {key, index, format, fanoutTotal}
      index++   
    }
  }

  console.log("fanout")
  console.log(fanout)
  
  // Save fanout before chunking modifies it
  const originalFanout = [...fanout];
  
  // chunk
  const CHUNKSIZE = 2;
  const chunks = [];

  while (fanout.length > 0) {
    chunks.push(fanout.splice(0, CHUNKSIZE));
  }

  console.log("chunks")
  console.log(chunks)

  if (isLocal) {
    console.log('Running in local mode - skipping DynamoDB update');
  }
  else {
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
        ":files": originalFanout
      },
    });
  }


  return chunks;
};
