import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import assert from "assert";
import { APIGatewayProxyHandlerV2 } from "aws-lambda";

const dynamo = DynamoDBDocument.from(new DynamoDB({}));

const { TABLE_NAME } = process.env;

export const handler: APIGatewayProxyHandlerV2<any> = async (event) => {
  assert(TABLE_NAME, "Missing TABLE_NAME");
  console.log(event.pathParameters);
  const id = event?.pathParameters?.id;
  return (
    await dynamo.get({
      TableName: TABLE_NAME,
      Key: { id },
    })
  ).Item;
};
