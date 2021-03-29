import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import assert from "assert";
import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { Array, Literal, Number, Record, String, Union } from "runtypes";
import { v4 as uuid } from "uuid";

const dynamo = DynamoDBDocument.from(new DynamoDB({}));

const { TABLE_NAME } = process.env;

const Input = Record({
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

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const result = Input.validate(JSON.parse(event.body || "{}"));
    if (!result.success) {
      return {
        statusCode: 400,
        body: `${result.message} (Key: ${result.key})`,
      };
    }
    assert(TABLE_NAME, "Missing TABLE_NAME");
    const id = uuid();
    await dynamo.put({
      TableName: TABLE_NAME,
      Item: {
        id,
        status: "PENDING",
        ...result.value,
      },
    });
    return {
      id,
      status: "PENDING",
      ...result.value,
    };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: `Internal Server Error: ${e}` };
  }
};
