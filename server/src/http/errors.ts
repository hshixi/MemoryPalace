import { ConfigError } from "../config.ts";
import { PolicyError, type PolicyErrorCode } from "../policy/paths.ts";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

function policyStatus(code: PolicyErrorCode): number {
  switch (code) {
    case "path_escape":
    case "permission_denied":
      return 403;
    case "not_found":
      return 404;
    case "invalid_path":
    case "not_a_directory":
    case "not_a_file":
      return 400;
    default:
      return 400;
  }
}

export function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof PolicyError) {
    return new HttpError(policyStatus(error.code), error.code, error.message);
  }
  if (error instanceof ConfigError) {
    return new HttpError(500, error.code, error.message);
  }
  if (error instanceof SyntaxError) {
    return new HttpError(400, "invalid_json", "请求体不是合法 JSON");
  }
  const message = error instanceof Error ? error.message : String(error);
  return new HttpError(500, "internal_error", message);
}

export function errorBody(error: HttpError): ErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };
}
