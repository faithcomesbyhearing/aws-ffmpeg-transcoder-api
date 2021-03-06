import { AttributeValue as SdkAttributeValue } from "@aws-sdk/client-dynamodb";
import {
  marshall as sdkMarshall,
  marshallOptions,
  NativeAttributeValue,
  unmarshall as sdkUnmarshall,
  unmarshallOptions,
} from "@aws-sdk/util-dynamodb";
import { AttributeValue as LambdaAttributeValue } from "aws-lambda";
import { TextDecoder, TextEncoder } from "util";

export function marshall<T extends { [K in keyof T]: NativeAttributeValue }>(
  data: T,
  options?: marshallOptions
): { [key: string]: LambdaAttributeValue } {
  const sdkResult = sdkMarshall(data, options);

  const result = Object.fromEntries(
    Object.entries(sdkResult).map(([key, value]) => {
      return [key, sdkToLambdaAttr(value)];
    })
  );

  return result;
}

function sdkToLambdaAttr(a: SdkAttributeValue): LambdaAttributeValue {
  if (a.B) return { B: new TextDecoder().decode(a.B) };
  if (a.BS) return { BS: a.BS.map((item) => new TextDecoder().decode(item)) };
  if (a.L) return { L: a.L.map(sdkToLambdaAttr) };
  if (a.M)
    return {
      M: Object.fromEntries(
        Object.entries(a.M).map(([key, value]) => [key, sdkToLambdaAttr(value)])
      ),
    };
  return a;
}

export function unmarshall(
  data: { [key: string]: LambdaAttributeValue },
  options?: unmarshallOptions
): { [key: string]: NativeAttributeValue } {
  const input = Object.fromEntries(
    Object.entries(data).map(([key, value]) => {
      return [key, lambdaToSdkAttr(value)];
    })
  );

  return sdkUnmarshall(input, options);
}

function lambdaToSdkAttr(a: LambdaAttributeValue): SdkAttributeValue {
  if (typeof a.B !== "undefined") return { B: new TextEncoder().encode(a.B) };
  if (typeof a.BS !== "undefined")
    return { BS: a.BS.map((item) => new TextEncoder().encode(item)) };
  if (typeof a.BOOL !== "undefined") return { BOOL: a.BOOL };
  if (typeof a.L !== "undefined") return { L: a.L.map(lambdaToSdkAttr) };
  if (typeof a.M !== "undefined")
    return {
      M: Object.fromEntries(
        Object.entries(a.M).map(([key, value]) => [key, lambdaToSdkAttr(value)])
      ),
    };
  if (typeof a.N !== "undefined") return { N: a.N };
  if (typeof a.NS !== "undefined") return { NS: a.NS };
  if (typeof a.NULL !== "undefined") return { NULL: true };
  if (typeof a.S !== "undefined") return { S: a.S };
  if (a.SS) return { SS: a.SS };
  throw new Error(`Unrecognized attribute value type: ${JSON.stringify(a)}`);
}
