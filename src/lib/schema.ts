import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv, type AnySchema, type ErrorObject, type ValidateFunction } from "ajv";
import { AppError } from "./errors.js";

type SchemaName = "group" | "api" | "cli-output";

const ajv = new Ajv({ allErrors: true, strict: false });
const validators = new Map<SchemaName, ValidateFunction>();

export function validateSchema(name: SchemaName, value: unknown, source: string): void {
  const validator = validatorFor(name);
  if (validator(value)) return;
  const details = (validator.errors ?? []).map((error) => schemaError(error, source));
  throw new AppError("invalid_config", `Configuration does not match the ${name} schema.`, details);
}

export function assertCliEnvelope(value: unknown): void {
  const validator = validatorFor("cli-output");
  if (validator(value)) return;
  throw new AppError("invalid_cli_output", "CLI output did not match its schema.", validator.errors ?? []);
}

function validatorFor(name: SchemaName): ValidateFunction {
  const cached = validators.get(name);
  if (cached) return cached;
  const filePath = fileURLToPath(new URL(`../schemas/${name}.schema.json`, import.meta.url));
  const schema = JSON.parse(readFileSync(filePath, "utf8")) as AnySchema;
  const validator = ajv.compile(schema);
  validators.set(name, validator);
  return validator;
}

function schemaError(error: ErrorObject, source: string): { path: string; message: string } {
  const suffix = error.instancePath ? error.instancePath.replaceAll("/", ".") : "";
  const path = `${source}${suffix}`;
  return { path, message: error.message ?? "did not match the schema." };
}
