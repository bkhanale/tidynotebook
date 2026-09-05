/*
 * Generated from packages/api-contract/openapi.yaml by tools/sdk-codegen.
 * Do not edit by hand. Run `pnpm generate` after a contract change.
 */

import type { SchemaObject } from 'ajv';

/** Every operation id declared by the contract. */
export type OperationId =
  | 'getHealth'
  | 'getReadiness';

export type HttpMethod =
  | 'get'
  | 'put'
  | 'post'
  | 'delete'
  | 'options'
  | 'head'
  | 'patch'
  | 'trace';

/** A JSON Schema 2020-12 object that Ajv can compile. */
export type JsonSchema = SchemaObject;

export type ParameterLocation = 'path' | 'query' | 'header' | 'cookie';

/** Explicit serialization of one parameter, copied from the contract. */
export type ParameterSerialization = {
  readonly name: string;
  readonly location: ParameterLocation;
  readonly required: boolean;
  readonly style: string;
  readonly explode: boolean;
};

/**
 * One schema for each request slot. The path, query, and header schemas always
 * exist. A closed empty object schema means the operation accepts no member of
 * that kind, so an unknown one is rejected. A null body means the operation
 * accepts no request body at all.
 */
export type RequestSchemas = {
  readonly params: JsonSchema;
  readonly query: JsonSchema;
  readonly headers: JsonSchema;
  readonly body: JsonSchema | null;
  readonly bodyMediaType: string | null;
};

/** One security requirement: scheme name to the scopes it must carry. */
export type SecurityRequirement = Readonly<Record<string, readonly string[]>>;

export type ResponseSchema = {
  readonly status: number;
  readonly mediaType: string;
  readonly schema: JsonSchema;
};

export type OperationEntry = {
  readonly id: OperationId;
  readonly method: HttpMethod;
  readonly path: string;
  /** Alternative security requirements. An empty list means public. */
  readonly security: readonly SecurityRequirement[];
  readonly parameters: readonly ParameterSerialization[];
  readonly request: RequestSchemas;
  readonly responses: readonly ResponseSchema[];
};

/** Version of the contract document that produced this index. */
export const contractVersion = '0.1.0';

export const operations: readonly OperationEntry[] = [
  {
    "id": "getHealth",
    "method": "get",
    "path": "/api/health",
    "security": [],
    "parameters": [
      {
        "name": "x-request-id",
        "location": "header",
        "required": false,
        "style": "simple",
        "explode": false
      }
    ],
    "request": {
      "params": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {},
        "additionalProperties": false
      },
      "query": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {},
        "additionalProperties": false
      },
      "headers": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "x-request-id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "pattern": "^[A-Za-z0-9._-]+$"
          }
        }
      },
      "body": null,
      "bodyMediaType": null
    },
    "responses": [
      {
        "status": 200,
        "mediaType": "application/json",
        "schema": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "object",
          "description": "Liveness report of the service process.",
          "additionalProperties": false,
          "required": [
            "status"
          ],
          "properties": {
            "status": {
              "type": "string",
              "readOnly": true,
              "description": "Always the literal value ok while the process answers.",
              "enum": [
                "ok"
              ]
            }
          }
        }
      },
      {
        "status": 400,
        "mediaType": "application/problem+json",
        "schema": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "object",
          "description": "RFC 9457 problem details. The code field carries the stable application error code that a client can branch on.",
          "additionalProperties": true,
          "required": [
            "type",
            "title",
            "status",
            "code",
            "requestId"
          ],
          "properties": {
            "type": {
              "type": "string",
              "readOnly": true,
              "description": "Stable URI reference that identifies the problem type.",
              "format": "uri-reference",
              "maxLength": 256
            },
            "title": {
              "type": "string",
              "readOnly": true,
              "description": "Short human readable summary of the problem type.",
              "maxLength": 256
            },
            "status": {
              "type": "integer",
              "readOnly": true,
              "description": "HTTP status code of this response.",
              "minimum": 100,
              "maximum": 599
            },
            "detail": {
              "type": "string",
              "readOnly": true,
              "description": "Explanation of this occurrence. The field never contains note content, a secret, or a stack trace.",
              "maxLength": 1024
            },
            "instance": {
              "type": "string",
              "readOnly": true,
              "description": "URI reference of the request that produced the problem.",
              "format": "uri-reference",
              "maxLength": 1024
            },
            "code": {
              "type": "string",
              "readOnly": true,
              "description": "Stable application error code.",
              "pattern": "^[a-z][a-z0-9_]*$",
              "maxLength": 64
            },
            "requestId": {
              "type": "string",
              "readOnly": true,
              "description": "Identifier of the request, repeated in the x-request-id header.",
              "minLength": 1,
              "maxLength": 128
            },
            "issues": {
              "type": "array",
              "readOnly": true,
              "description": "Values that a boundary check rejected. Each entry names the value by JSON Pointer and never repeats the value itself.",
              "maxItems": 64,
              "items": {
                "type": "object",
                "description": "One value that a boundary check rejected.",
                "additionalProperties": false,
                "required": [
                  "path",
                  "message"
                ],
                "properties": {
                  "path": {
                    "type": "string",
                    "readOnly": true,
                    "description": "JSON Pointer of the rejected value inside its request slot.",
                    "maxLength": 256
                  },
                  "message": {
                    "type": "string",
                    "readOnly": true,
                    "description": "Reason the value was rejected. It never repeats the value.",
                    "maxLength": 256
                  }
                }
              }
            }
          }
        }
      },
      {
        "status": 500,
        "mediaType": "application/problem+json",
        "schema": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "object",
          "description": "RFC 9457 problem details. The code field carries the stable application error code that a client can branch on.",
          "additionalProperties": true,
          "required": [
            "type",
            "title",
            "status",
            "code",
            "requestId"
          ],
          "properties": {
            "type": {
              "type": "string",
              "readOnly": true,
              "description": "Stable URI reference that identifies the problem type.",
              "format": "uri-reference",
              "maxLength": 256
            },
            "title": {
              "type": "string",
              "readOnly": true,
              "description": "Short human readable summary of the problem type.",
              "maxLength": 256
            },
            "status": {
              "type": "integer",
              "readOnly": true,
              "description": "HTTP status code of this response.",
              "minimum": 100,
              "maximum": 599
            },
            "detail": {
              "type": "string",
              "readOnly": true,
              "description": "Explanation of this occurrence. The field never contains note content, a secret, or a stack trace.",
              "maxLength": 1024
            },
            "instance": {
              "type": "string",
              "readOnly": true,
              "description": "URI reference of the request that produced the problem.",
              "format": "uri-reference",
              "maxLength": 1024
            },
            "code": {
              "type": "string",
              "readOnly": true,
              "description": "Stable application error code.",
              "pattern": "^[a-z][a-z0-9_]*$",
              "maxLength": 64
            },
            "requestId": {
              "type": "string",
              "readOnly": true,
              "description": "Identifier of the request, repeated in the x-request-id header.",
              "minLength": 1,
              "maxLength": 128
            },
            "issues": {
              "type": "array",
              "readOnly": true,
              "description": "Values that a boundary check rejected. Each entry names the value by JSON Pointer and never repeats the value itself.",
              "maxItems": 64,
              "items": {
                "type": "object",
                "description": "One value that a boundary check rejected.",
                "additionalProperties": false,
                "required": [
                  "path",
                  "message"
                ],
                "properties": {
                  "path": {
                    "type": "string",
                    "readOnly": true,
                    "description": "JSON Pointer of the rejected value inside its request slot.",
                    "maxLength": 256
                  },
                  "message": {
                    "type": "string",
                    "readOnly": true,
                    "description": "Reason the value was rejected. It never repeats the value.",
                    "maxLength": 256
                  }
                }
              }
            }
          }
        }
      }
    ]
  },
  {
    "id": "getReadiness",
    "method": "get",
    "path": "/api/ready",
    "security": [],
    "parameters": [
      {
        "name": "x-request-id",
        "location": "header",
        "required": false,
        "style": "simple",
        "explode": false
      },
      {
        "name": "detail",
        "location": "query",
        "required": false,
        "style": "form",
        "explode": true
      }
    ],
    "request": {
      "params": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {},
        "additionalProperties": false
      },
      "query": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "detail": {
            "type": "string",
            "enum": [
              "summary",
              "full"
            ]
          }
        },
        "additionalProperties": false
      },
      "headers": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "x-request-id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "pattern": "^[A-Za-z0-9._-]+$"
          }
        }
      },
      "body": null,
      "bodyMediaType": null
    },
    "responses": [
      {
        "status": 200,
        "mediaType": "application/json",
        "schema": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "object",
          "description": "Readiness report of every startup requirement.",
          "additionalProperties": false,
          "required": [
            "status",
            "checks"
          ],
          "properties": {
            "status": {
              "type": "string",
              "readOnly": true,
              "description": "Overall readiness. The value is degraded when at least one check is degraded.",
              "enum": [
                "ok",
                "degraded"
              ]
            },
            "checks": {
              "type": "array",
              "readOnly": true,
              "description": "One entry for every startup requirement that was checked.",
              "minItems": 1,
              "maxItems": 32,
              "items": {
                "type": "object",
                "description": "State of one startup requirement.",
                "additionalProperties": false,
                "required": [
                  "name",
                  "status"
                ],
                "properties": {
                  "name": {
                    "type": "string",
                    "readOnly": true,
                    "description": "Stable name of the requirement, for example configuration.",
                    "minLength": 1,
                    "maxLength": 64
                  },
                  "status": {
                    "type": "string",
                    "readOnly": true,
                    "description": "State of this requirement.",
                    "enum": [
                      "ok",
                      "degraded"
                    ]
                  },
                  "detail": {
                    "type": "string",
                    "readOnly": true,
                    "description": "Operator readable explanation. The field is absent in a summary report and it never contains note content or a secret.",
                    "maxLength": 512
                  }
                }
              }
            }
          }
        }
      },
      {
        "status": 400,
        "mediaType": "application/problem+json",
        "schema": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "object",
          "description": "RFC 9457 problem details. The code field carries the stable application error code that a client can branch on.",
          "additionalProperties": true,
          "required": [
            "type",
            "title",
            "status",
            "code",
            "requestId"
          ],
          "properties": {
            "type": {
              "type": "string",
              "readOnly": true,
              "description": "Stable URI reference that identifies the problem type.",
              "format": "uri-reference",
              "maxLength": 256
            },
            "title": {
              "type": "string",
              "readOnly": true,
              "description": "Short human readable summary of the problem type.",
              "maxLength": 256
            },
            "status": {
              "type": "integer",
              "readOnly": true,
              "description": "HTTP status code of this response.",
              "minimum": 100,
              "maximum": 599
            },
            "detail": {
              "type": "string",
              "readOnly": true,
              "description": "Explanation of this occurrence. The field never contains note content, a secret, or a stack trace.",
              "maxLength": 1024
            },
            "instance": {
              "type": "string",
              "readOnly": true,
              "description": "URI reference of the request that produced the problem.",
              "format": "uri-reference",
              "maxLength": 1024
            },
            "code": {
              "type": "string",
              "readOnly": true,
              "description": "Stable application error code.",
              "pattern": "^[a-z][a-z0-9_]*$",
              "maxLength": 64
            },
            "requestId": {
              "type": "string",
              "readOnly": true,
              "description": "Identifier of the request, repeated in the x-request-id header.",
              "minLength": 1,
              "maxLength": 128
            },
            "issues": {
              "type": "array",
              "readOnly": true,
              "description": "Values that a boundary check rejected. Each entry names the value by JSON Pointer and never repeats the value itself.",
              "maxItems": 64,
              "items": {
                "type": "object",
                "description": "One value that a boundary check rejected.",
                "additionalProperties": false,
                "required": [
                  "path",
                  "message"
                ],
                "properties": {
                  "path": {
                    "type": "string",
                    "readOnly": true,
                    "description": "JSON Pointer of the rejected value inside its request slot.",
                    "maxLength": 256
                  },
                  "message": {
                    "type": "string",
                    "readOnly": true,
                    "description": "Reason the value was rejected. It never repeats the value.",
                    "maxLength": 256
                  }
                }
              }
            }
          }
        }
      },
      {
        "status": 500,
        "mediaType": "application/problem+json",
        "schema": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "object",
          "description": "RFC 9457 problem details. The code field carries the stable application error code that a client can branch on.",
          "additionalProperties": true,
          "required": [
            "type",
            "title",
            "status",
            "code",
            "requestId"
          ],
          "properties": {
            "type": {
              "type": "string",
              "readOnly": true,
              "description": "Stable URI reference that identifies the problem type.",
              "format": "uri-reference",
              "maxLength": 256
            },
            "title": {
              "type": "string",
              "readOnly": true,
              "description": "Short human readable summary of the problem type.",
              "maxLength": 256
            },
            "status": {
              "type": "integer",
              "readOnly": true,
              "description": "HTTP status code of this response.",
              "minimum": 100,
              "maximum": 599
            },
            "detail": {
              "type": "string",
              "readOnly": true,
              "description": "Explanation of this occurrence. The field never contains note content, a secret, or a stack trace.",
              "maxLength": 1024
            },
            "instance": {
              "type": "string",
              "readOnly": true,
              "description": "URI reference of the request that produced the problem.",
              "format": "uri-reference",
              "maxLength": 1024
            },
            "code": {
              "type": "string",
              "readOnly": true,
              "description": "Stable application error code.",
              "pattern": "^[a-z][a-z0-9_]*$",
              "maxLength": 64
            },
            "requestId": {
              "type": "string",
              "readOnly": true,
              "description": "Identifier of the request, repeated in the x-request-id header.",
              "minLength": 1,
              "maxLength": 128
            },
            "issues": {
              "type": "array",
              "readOnly": true,
              "description": "Values that a boundary check rejected. Each entry names the value by JSON Pointer and never repeats the value itself.",
              "maxItems": 64,
              "items": {
                "type": "object",
                "description": "One value that a boundary check rejected.",
                "additionalProperties": false,
                "required": [
                  "path",
                  "message"
                ],
                "properties": {
                  "path": {
                    "type": "string",
                    "readOnly": true,
                    "description": "JSON Pointer of the rejected value inside its request slot.",
                    "maxLength": 256
                  },
                  "message": {
                    "type": "string",
                    "readOnly": true,
                    "description": "Reason the value was rejected. It never repeats the value.",
                    "maxLength": 256
                  }
                }
              }
            }
          }
        }
      },
      {
        "status": 503,
        "mediaType": "application/problem+json",
        "schema": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "object",
          "description": "RFC 9457 problem details. The code field carries the stable application error code that a client can branch on.",
          "additionalProperties": true,
          "required": [
            "type",
            "title",
            "status",
            "code",
            "requestId"
          ],
          "properties": {
            "type": {
              "type": "string",
              "readOnly": true,
              "description": "Stable URI reference that identifies the problem type.",
              "format": "uri-reference",
              "maxLength": 256
            },
            "title": {
              "type": "string",
              "readOnly": true,
              "description": "Short human readable summary of the problem type.",
              "maxLength": 256
            },
            "status": {
              "type": "integer",
              "readOnly": true,
              "description": "HTTP status code of this response.",
              "minimum": 100,
              "maximum": 599
            },
            "detail": {
              "type": "string",
              "readOnly": true,
              "description": "Explanation of this occurrence. The field never contains note content, a secret, or a stack trace.",
              "maxLength": 1024
            },
            "instance": {
              "type": "string",
              "readOnly": true,
              "description": "URI reference of the request that produced the problem.",
              "format": "uri-reference",
              "maxLength": 1024
            },
            "code": {
              "type": "string",
              "readOnly": true,
              "description": "Stable application error code.",
              "pattern": "^[a-z][a-z0-9_]*$",
              "maxLength": 64
            },
            "requestId": {
              "type": "string",
              "readOnly": true,
              "description": "Identifier of the request, repeated in the x-request-id header.",
              "minLength": 1,
              "maxLength": 128
            },
            "issues": {
              "type": "array",
              "readOnly": true,
              "description": "Values that a boundary check rejected. Each entry names the value by JSON Pointer and never repeats the value itself.",
              "maxItems": 64,
              "items": {
                "type": "object",
                "description": "One value that a boundary check rejected.",
                "additionalProperties": false,
                "required": [
                  "path",
                  "message"
                ],
                "properties": {
                  "path": {
                    "type": "string",
                    "readOnly": true,
                    "description": "JSON Pointer of the rejected value inside its request slot.",
                    "maxLength": 256
                  },
                  "message": {
                    "type": "string",
                    "readOnly": true,
                    "description": "Reason the value was rejected. It never repeats the value.",
                    "maxLength": 256
                  }
                }
              }
            }
          }
        }
      }
    ]
  }
];
