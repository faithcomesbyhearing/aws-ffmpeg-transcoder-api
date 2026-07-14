import { paginateListObjectsV2, S3 } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import archiver from 'archiver';
import { strict as assert } from "assert";
import { Handler } from "aws-lambda";
import pLimit from 'p-limit';
import { Optional, Record, String, Array } from "runtypes";
import { Readable } from "stream";
import { parse } from 'path';

const isLocal = process.env.NODE_ENV === 'local';

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

    let upload: Upload | null = null;
    let uploadDone: Promise<any> | null = null;
    
    if (isLocal) {
      console.log('Running in local mode - skipping S3 upload');
    } else {
      upload = new Upload({
        client: s3,
        params: {
          Bucket: targetBucket,
          Key: targetPath.slice(1),
          Body: archive,
          ACL: 'bucket-owner-full-control',
        }
      });
      uploadDone = upload.done();
    }
    
    const limit = pLimit(5);
    const files: { key: string, name: string }[] = [];
    
    const promises: Promise<any>[] = [];
    if (uploadDone) promises.push(uploadDone);
    
    if (isLocal) {
      // In local mode, create a mock zip with no files
      promises.push(new Promise<void>(async (resolve) => {
        console.log('Local mode: Creating empty zip archive');
        await archive.finalize();
        resolve();
      }));
    } else {
      // Production mode: Process S3 files
      const Prefix = sourcePath.slice(1);
      promises.push(new Promise<void>(async (resolve, reject) => {
        for await (const output of paginateListObjectsV2({ client: s3 }, { Bucket: sourceBucket, Prefix })) {
          files.push(
            ...output.Contents?.map((x) => x.Key!)
              .map(key => ({ key, name: key.replace(Prefix, directoryName) }))
              .filter(({ key }) => !result.value.fileTypes || result.value.fileTypes.includes(parse(key).ext.slice(1))) ?? []
          );
        }

        if (files.length == 0) reject('No files were found');

        await Promise.all(files.map(({ key, name }) => limit(async () => {
          const response = await s3.getObject({ Bucket: sourceBucket, Key: key });
          if (!response.Body) throw new Error(`No body found for key: ${key}`);
          const sourceStream = response.Body as Readable;
          await new Promise(resolve => {
            sourceStream.once('end', resolve);
            archive.append(sourceStream, { name });
          });
        })) || []);
        await archive.finalize();
        resolve();
      }));
    }

    await Promise.all(promises);

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
