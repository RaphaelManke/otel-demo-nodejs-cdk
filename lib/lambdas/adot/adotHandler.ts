import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { randomInt, randomUUID } from "crypto";
import nodeFetch from "node-fetch";
const dynamodb = new DynamoDBClient({});
const documentClient = DynamoDBDocument.from(dynamodb);
const handler = async (event: any) => {
  const userId = randomInt(0, 10);
  const user = await fetch(
    `https://jsonplaceholder.typicode.com/users/${userId}`
  );

  const user2 = await nodeFetch(
    `https://jsonplaceholder.typicode.com/comments`
  );
  const userData2 = await user2.json();

  const userData = await user.json();

  const itemId = randomUUID();
  const params = {
    TableName: process.env.TABLE_NAME,
    Item: {
      ...userData,
      id: itemId,
    },
  };

  await documentClient.put(params);
  return {
    statusCode: 200,
    body: JSON.stringify(params.Item),
  };
};

module.exports = { handler };
