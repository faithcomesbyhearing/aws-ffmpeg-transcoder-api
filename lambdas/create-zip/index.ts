import { paginateListObjectsV2, S3 } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import archiver from 'archiver';
import { strict as assert } from "assert";
import { Handler } from "aws-lambda";
import pLimit from 'p-limit';
import { Optional, Record, String, Array } from "runtypes";
import { Readable } from "stream";
import { parse } from 'path';

const s3 = new S3({});

const Event = Record({
  source: String,
  target: String,
  directoryName: Optional(String),
  fileTypes: Optional(Array(String)),
});
export const handler: Handler = async (event) => {
  try {
    const result = Event.validate(event);
    if (!result.success) throw new Error(`Record failed validation: ${result.message}`);

    const {
      protocol: sourceProtocol,
      hostname: sourceBucket,
      pathname: sourcePath,
    } = new URL(result.value.source);
    assert.equal(sourceProtocol, 's3:', 'Source must be an S3 URL');
    assert(sourcePath.startsWith('/'), 'Source URL should start with a /');
    assert(sourcePath.endsWith('/'), 'Source URL should end with a /');

    const {
      protocol: targetProtocol,
      hostname: targetBucket,
      pathname: targetPath,
    } = new URL(result.value.target);
    assert.equal(targetProtocol, 's3:', 'Target must be an S3 URL');
    assert(targetPath.startsWith('/'), 'Target URL should start with .zip');
    assert(targetPath.endsWith('.zip'), 'Target URL should end with .zip');

    let directoryName = result.value.directoryName ? (result.value.directoryName + '/') : '';

    console.log(`Creating zip from ${result.value.source} to ${result.value.target}`);

    const archive = archiver('zip', {})

    const upload = new Upload({
      client: s3,
      params: {
        Bucket: targetBucket,
        Key: targetPath.slice(1),
        Body: archive,
        ACL: 'bucket-owner-full-control',
      }
    });
    const uploadDone = upload.done();
    const limit = pLimit(5);
    const files: { key: string, name: string }[] = [];
    const Prefix = sourcePath.slice(1);
    await Promise.all([
      uploadDone,
      new Promise<void>(async (resolve, reject) => {
        for await (const output of paginateListObjectsV2({ client: s3 }, { Bucket: sourceBucket, Prefix })) {
          files.push(
            ...output.Contents?.map((x) => x.Key!)
              .map(key => ({ key, name: key.replace(Prefix, directoryName) }))
              .filter(({ key }) => !result.value.fileTypes || result.value.fileTypes.includes(parse(key).ext.slice(1))) ?? []
          );
        }

        if (files.length == 0) reject('No files were found');

        await Promise.all(files.map(({ key, name }) => limit(async () => {
          const sourceStream: Readable = (await s3.getObject({ Bucket: sourceBucket, Key: key })).Body;
          await new Promise(resolve => {
            sourceStream.once('end', resolve);
            archive.append(sourceStream, { name });
          });
        })) || []);
        await archive.finalize();
        resolve();
      }),
    ]);

    return {
      status: 'SUCCESS',
      source: result.value.source,
      target: result.value.target,
      files: files.map(({ name }) => name),
    };
  } catch (e) {
    console.error(e);
    if (e instanceof Error) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          status: 'FAILED',
          error: e.message,
        })
      };
    }
  }
};

// See https://github.com/DefinitelyTyped/DefinitelyTyped/issues/34960

interface URL {
  hostname: string;
  pathname: string;
  protocol: string;
}

declare var URL: {
  new(url: string): URL;
};
