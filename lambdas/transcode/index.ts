import { Handler } from "aws-lambda";
import { S3 } from "@aws-sdk/client-s3";
import { spawn, SpawnOptionsWithoutStdio } from "child_process";
import fs, { promises as fsp } from "fs";
import os from "os";
import path from "path";
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import assert from "assert";
import { Readable } from "stream";
import { Upload } from "@aws-sdk/lib-storage";

const s3 = new S3({});
const dynamo = DynamoDBDocument.from(new DynamoDB({ maxAttempts: 8 }));

const { TABLE_NAME } = process.env;

type Event = {
  id: string;
  index: number;
  input: {
    bucket: string;
    key: string;
  };
  output: {
    bucket: string;
    key: string;
    bitrate: number;
    container: "mp3" | "mp4" | "webm";
    codec: "mp3" | "aac" | "opus";
  };
};

export const handler: Handler<Event> = async (event: Event, context) => {
  assert(TABLE_NAME, "Missing TABLE_NAME");

  const dir = path.join(os.tmpdir(), context.awsRequestId);
  await fsp.mkdir(dir);

  const inputFilePath = path.join(
    dir,
    `input.${path.parse(event.input.key).ext}`
  );
  const outputFilePath = path.join(
    dir,
    `output.${path.parse(event.output.key).ext}`
  );

  try {
    await download(event.input.bucket, event.input.key, inputFilePath);
    const inputDuration = await duration(inputFilePath);
    switch (event.output.container + "|" + event.output.codec) {
      case "mp3|mp3":
        await exec(
          [
            "ffmpeg -y -i",
            inputFilePath,
            "-map 0:a",
            "-c:a libmp3lame",
            `-b:a ${event.output.bitrate}k`,
            outputFilePath,
          ].join(" "),
          { cwd: dir }
        );
        break;
      case "mp4|aac":
        await exec(
          [
            "ffmpeg -y -i",
            inputFilePath,
            "-map 0:a",
            "-c:a aac",
            `-b:a ${event.output.bitrate}k`,
            outputFilePath,
          ].join(" "),
          { cwd: dir }
        );
        break;
      case "webm|opus":
        await exec(
          [
            "ffmpeg -y -i",
            inputFilePath,
            "-map 0:a",
            "-c:a libopus",
            `-b:a ${event.output.bitrate}k`,
            "-vbr off",
            "-application voip",
            outputFilePath,
          ].join(" "),
          { cwd: dir }
        );
        break;
    }
    const outputDuration = await duration(outputFilePath);
    await upload(event.output.bucket, event.output.key, outputFilePath);

    await dynamo.update({
      TableName: TABLE_NAME,
      Key: { id: event.id },
      ConditionExpression: "attribute_exists(id)",
      UpdateExpression: `SET #remaining = #remaining - :one, #files[${event.index}].#status = :success, files[${event.index}].#input.#duration = :inputDuration, #files[${event.index}].#output.#duration = :outputDuration`,
      ExpressionAttributeNames: {
        "#duration": "duration",
        "#files": "files",
        "#input": "input",
        "#output": "output",
        "#remaining": "remaining",
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":one": 1,
        ":success": "SUCCESS",
        ":inputDuration": inputDuration,
        ":outputDuration": outputDuration,
      },
    });
  } finally {
    await fsp.rmdir(dir, { recursive: true });
  }
};

async function download(Bucket: string, Key: string, filePath: string) {
  console.log(`Downloading s3://${Bucket}/${Key} to ${filePath}`);
  return new Promise(async (resolve, reject) =>
    ((await s3.getObject({ Bucket, Key })).Body as Readable)
      .on("error", reject)
      .pipe(fs.createWriteStream(filePath))
      .on("error", reject)
      .on("finish", resolve)
  );
}

async function upload(Bucket: string, Key: string, filePath: string) {
  console.log(`Uploading ${filePath} to s3://${Bucket}/${Key}`);
  const upload = new Upload({
    client: s3,
    params: { Bucket, Key, Body: fs.createReadStream(filePath) },
  });
  await upload.done();
}

async function duration(fileName: string): Promise<number> {
  const result = await exec(
    [
      "ffprobe",
      "-loglevel quiet",
      "-show_entries format=duration",
      "-print_format default=noprint_wrappers=1:nokey=1",
      fileName,
    ].join(" "),
    undefined,
    true
  );
  console.log(`File ${fileName} has duration: ${result}`);
  return parseFloat(result) || -1;
}

function exec(
  command: string,
  options?: SpawnOptionsWithoutStdio,
  stdout?: true
): Promise<string>;
function exec(
  command: string,
  options?: SpawnOptionsWithoutStdio,
  stdout?: false
): Promise<void>;
function exec(
  command: string,
  options?: SpawnOptionsWithoutStdio,
  stdout = false
): Promise<string | void> {
  console.log(`Executing "${command}" with options: ${options}`);
  return new Promise((resolve, reject) => {
    const process = spawn(command, { shell: true, ...options });
    let result = "";
    if (stdout) {
      process.stdout.on("data", (x) => (result += x.toString()));
    } else {
      process.stdout.on("data", (x) => console.log(x.toString()));
      process.stderr.on("data", (x) => console.log(x.toString()));
    }
    process.on("exit", (code, signal) => {
      if (code || signal) {
        console.error({ code, signal, command });
        reject();
      } else {
        if (stdout) {
          resolve(result);
        } else {
          resolve();
        }
      }
    });
  });
}
