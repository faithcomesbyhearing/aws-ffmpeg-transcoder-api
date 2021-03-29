import { Handler } from "aws-lambda";
import crypto from 'crypto';

const { SECRET } = process.env;

export const handler: Handler = async (event) => {
  const apikey = event.headers['x-api-key'];
  const salt = apikey.substring(0, 32);
  const hashA = apikey.substring(32);
  const hashB = crypto.pbkdf2Sync(SECRET!, Buffer.from(salt, 'hex'), 100, 16, 'sha256').toString('hex');
  return {
    isAuthorized: hashA === hashB
  };
};
