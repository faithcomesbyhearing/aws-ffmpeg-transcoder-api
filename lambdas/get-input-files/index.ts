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
  const keys = [];
  const { bucket: Bucket, key: Prefix } = job.input;
  let tempCt = 0;
  for await (const output of paginateListObjectsV2({ client: s3 }, { Bucket, Prefix })) {
    for (const key of output.Contents?.map((x) => x.Key!) || []) {
      if (!key.replace(`${Prefix}/`, "").includes("/") && !key.endsWith(".zip")) {
        keys.push(key);
        // temporary for testing
        tempCt++
        if (tempCt > 4){
          break
        }
        // end temporary for testing
      }
    }
  }

  assert(keys.length > 0, "No input files found");
  job.keyscount = keys.length

  // fanout
  // - transfer to local vars so I can test externally
  let outputLen = job.output.length
  let keyslen = job.keyscount
  let fanoutTotal = keyslen*outputLen; 
  let output = job.output 
  //--

  const fanout = [];
  let index = 0 ;
  for (let j= 0; j<keyslen; j++) {
    let key = keys[j]
    for (let i = 0; i < outputLen; i++) {
      let format = [ output[i].key, output[i].container,  output[i].codec,  output[i].bitrate].join("|")
      fanout[index] = {key, index, format, fanoutTotal}
      index++   
    }
  }

  console.log("fanout")
  console.log(fanout)
  
  // chunk
  const CHUNKSIZE = 2
  const chunks =[] 

  while (fanout.length > 0) {
    chunks.push(fanout.splice(0, CHUNKSIZE));
  }

  
  console.log("chunks")
  console.log(chunks)
  //^^^ end local testing

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
      // ":files": keys.map((_, index) => ({ index })),
      ":files": fanout
    },
  });


  return chunks;
};
