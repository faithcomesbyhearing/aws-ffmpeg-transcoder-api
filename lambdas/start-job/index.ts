import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { SFN } from "@aws-sdk/client-sfn";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import assert from "assert";
import { DynamoDBStreamHandler } from "aws-lambda";
import { Array, Literal, Number, Record, String, Union } from "runtypes";
import { unmarshall } from "./dynamodb";

const sfn = new SFN({});
const dynamo = DynamoDBDocument.from(new DynamoDB({}));

const isLocal = process.env.NODE_ENV === 'local';

const { STATE_MACHINE_ARN, TABLE_NAME } = process.env;

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

export const handler: DynamoDBStreamHandler = async (event) => {
  assert(STATE_MACHINE_ARN, "Missing SFN_ARN");
  assert(TABLE_NAME, "Missing TABLE_NAME");
  
  if (isLocal) {
    console.log('Running in local mode - skipping AWS calls');
  }
  
  for (const record of event.Records) {
    if (record.eventName == "INSERT") {
      const data = unmarshall(record.dynamodb!.NewImage!);
      const result = Job.validate(data);
      if (!result.success) {
        console.error(
          `Record failed validation: ${result.message} (Data: ${data})`
        );
        continue;
      }
      const job = result.value;
      
      if (isLocal) {
        console.log(`Local mode: Would start execution for job ${job.id} with state machine ${STATE_MACHINE_ARN}`);
        console.log(`Local mode: Would update DynamoDB table ${TABLE_NAME} with mock execution ARN`);
        console.log('Job data:', JSON.stringify(job, null, 2));
      } else {
        const { executionArn } = await sfn.startExecution({
          stateMachineArn: STATE_MACHINE_ARN,
          input: JSON.stringify(job),
        });
        await dynamo.update({
          TableName: TABLE_NAME,
          Key: { id: job.id },
          ConditionExpression: "attribute_exists(id)",
          UpdateExpression: "SET #executionArn = :executionArn",
          ExpressionAttributeNames: { "#executionArn": "executionArn" },
          ExpressionAttributeValues: { ":executionArn": executionArn },
        });
      }
    }
  }
};
