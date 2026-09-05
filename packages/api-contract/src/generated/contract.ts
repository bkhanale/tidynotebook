/*
 * Generated from packages/api-contract/openapi.yaml by tools/sdk-codegen.
 * Do not edit by hand. Run `pnpm generate` after a contract change.
 */

import type { SchemaObject } from 'ajv';

/** Every operation id declared by the contract. */
export type OperationId =
  | 'acceptInvitation'
  | 'createAgentToken'
  | 'createWorkspace'
  | 'deleteWorkspace'
  | 'getAccount'
  | 'getAuthSession'
  | 'getHealth'
  | 'getReadiness'
  | 'inviteMember'
  | 'listAgentTokens'
  | 'listMembers'
  | 'listWorkspaces'
  | 'removeMember'
  | 'requestPasswordReset'
  | 'resetPassword'
  | 'revokeAgentToken'
  | 'signInWithPassword'
  | 'signInWithProvider'
  | 'signOut'
  | 'transferOwnership'
  | 'updateMember'
  | 'updatePreferences'
  | 'updateWorkspace';

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
  /**
   * The protocol library that serves this operation, or null.
   *
   * A protocol operation is implemented by a maintained library rather than by
   * a contract handler. The server registers it through that adapter's exact
   * path list and leaves it out of the one-handler-per-operation check.
   */
  readonly protocol: string | null;
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
    "id": "acceptInvitation",
    "method": "post",
    "path": "/api/invitations/acceptance",
    "protocol": null,
    "security": [
      {
        "sessionCookie": []
      }
    ],
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
      "body": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "description": "The invitation token to consume.",
        "additionalProperties": false,
        "required": [
          "token"
        ],
        "properties": {
          "token": {
            "type": "string",
            "description": "The invitation token that was handed to the invited person.",
            "minLength": 32,
            "maxLength": 128
          }
        }
      },
      "bodyMediaType": "application/json"
    },
    "responses": [
      {
        "status": 200,
        "mediaType": "application/json",
        "schema": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "object",
          "description": "The workspace and the role that an invitation granted.",
          "additionalProperties": false,
          "required": [
            "workspaceId",
            "role"
          ],
          "properties": {
            "workspaceId": {
              "allOf": [
                {
                  "type": "string",
                  "description": "A UUID that names one record.",
                  "format": "uuid",
                  "minLength": 36,
                  "maxLength": 36,
                  "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
                }
              ],
              "readOnly": true,
              "description": "Workspace that the account joined."
            },
            "role": {
              "allOf": [
                {
                  "type": "string",
                  "description": "Workspace membership role. A viewer reads, an editor also writes, an administrator also manages membership and shares, and the owner also purges and transfers the workspace.",
                  "enum": [
                    "owner",
                    "admin",
                    "editor",
                    "viewer"
                  ]
                }
              ],
              "readOnly": true,
              "description": "Role that the account received."
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
        "status": 401,
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
        "status": 403,
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
        "status": 404,
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
        "status": 413,
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
        "status": 415,
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
    "id": "createAgentToken",
    "method": "post",
    "path": "/api/agent-tokens",
    "protocol": null,
    "security": [
      {
        "sessionCookie": []
      }
    ],
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
      "body": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "description": "The name, the expiry, and the scope of a new agent token.",
        "additionalProperties": false,
        "required": [
          "name",
          "expiresAt",
          "scopes"
        ],
        "properties": {
          "name": {
            "type": "string",
            "description": "Name that identifies the token to its account.",
            "minLength": 1,
            "maxLength": 200
          },
          "expiresAt": {
            "type": "string",
            "description": "Instant after which the token is refused. An expiry is required and can never be more than one year away.",
            "format": "date-time",
            "minLength": 20,
            "maxLength": 64
          },
          "scopes": {
            "type": "array",
            "description": "Workspace and action scope of the token. It can never be wider than the current role of the account in that workspace.",
            "minItems": 1,
            "maxItems": 100,
            "items": {
              "type": "object",
              "description": "The workspace and the actions that one agent token may use.",
              "additionalProperties": false,
              "required": [
                "workspaceId",
                "actions"
              ],
              "properties": {
                "workspaceId": {
                  "allOf": [
                    {
                      "type": "string",
                      "description": "A UUID that names one record.",
                      "format": "uuid",
                      "minLength": 36,
                      "maxLength": 36,
                      "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
                    }
                  ],
                  "description": "Workspace that the scope applies to."
                },
                "actions": {
                  "type": "array",
                  "description": "Actions that the token may perform in that workspace.",
                  "minItems": 1,
                  "maxItems": 6,
                  "items": {
                    "type": "string",
                    "description": "One permitted kind of operation inside one workspace.",
                    "enum": [
                      "read",
                      "write",
                      "history",
                      "share",
                      "members",
                      "purge"
                    ]
                  }
                }
              }
            }
          }
        }
      },
      "bodyMediaType": "application/json"
    },
    "responses": [
      {
        "status": 201,
        "mediaType": "application/json",
        "schema": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "object",
          "description": "A new agent token and its secret, which is shown once.",
          "additionalProperties": false,
          "required": [
            "token",
            "secret"
          ],
          "properties": {
            "token": {
              "allOf": [
                {
                  "type": "object",
                  "description": "One agent token without its secret.",
                  "additionalProperties": false,
                  "required": [
                    "id",
                    "name",
                    "prefix",
                    "scopes",
                    "expiresAt",
                    "createdAt"
                  ],
                  "properties": {
                    "id": {
                      "allOf": [
                        {
                          "type": "string",
                          "description": "A UUID that names one record.",
                          "format": "uuid",
                          "minLength": 36,
                          "maxLength": 36,
                          "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
                        }
                      ],
                      "readOnly": true,
                      "description": "Identifier of the token."
                    },
                    "name": {
                      "type": "string",
                      "readOnly": true,
                      "description": "Name that the account gave the token.",
                      "minLength": 1,
                      "maxLength": 200
                    },
                    "prefix": {
                      "type": "string",
                      "readOnly": true,
                      "description": "Public prefix of the secret, which names the token in a list.",
                      "minLength": 4,
                      "maxLength": 32
                    },
                    "scopes": {
                      "type": "array",
                      "readOnly": true,
                      "description": "The stored scope of the token.",
                      "minItems": 1,
                      "maxItems": 100,
                      "items": {
                        "type": "object",
                        "description": "The workspace and the actions that one agent token may use.",
                        "additionalProperties": false,
                        "required": [
                          "workspaceId",
                          "actions"
                        ],
                        "properties": {
                          "workspaceId": {
                            "allOf": [
                              {
                                "type": "string",
                                "description": "A UUID that names one record.",
                                "format": "uuid",
                                "minLength": 36,
                                "maxLength": 36,
                                "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
                              }
                            ],
                            "description": "Workspace that the scope applies to."
                          },
                          "actions": {
                            "type": "array",
                            "description": "Actions that the token may perform in that workspace.",
                            "minItems": 1,
                            "maxItems": 6,
                            "items": {
                              "type": "string",
                              "description": "One permitted kind of operation inside one workspace.",
                              "enum": [
                                "read",
                                "write",
                                "history",
                                "share",
                                "members",
                                "purge"
                              ]
                            }
                          }
                        }
                      }
                    },
                    "expiresAt": {
                      "type": "string",
                      "readOnly": true,
                      "description": "Instant after which the token is refused.",
                      "format": "date-time",
                      "maxLength": 64
                    },
                    "createdAt": {
                      "type": "string",
                      "readOnly": true,
                      "description": "Instant at which the token was created.",
                      "format": "date-time",
                      "maxLength": 64
                    },
                    "revokedAt": {
                      "type": [
                        "string",
                        "null"
                      ],
                      "readOnly": true,
                      "description": "Instant at which the token was revoked, or null.",
                      "format": "date-time",
                      "maxLength": 64
                    }
                  }
                }
              ],
              "readOnly": true,
              "description": "The stored token."
            },
            "secret": {
              "type": "string",
              "readOnly": true,
              "description": "The token secret. It appears in this answer only, because storage keeps its hash.",
              "minLength": 32,
              "maxLength": 128
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
        "status": 401,
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
        "status": 403,
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
        "status": 413,
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
        "status": 415,
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
    "id": "createWorkspace",
    "method": "post",
    "path": "/api/workspaces",
    "protocol": null,
    "security": [
      {
        "sessionCookie": []
      }
    ],
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
      "body": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "description": "The name to give a workspace.",
        "additionalProperties": false,
        "required": [
          "name"
        ],
        "properties": {
          "name": {
            "type": "string",
            "description": "Name of the workspace.",
            "minLength": 1,
            "maxLength": 200
          }
        }
      },
      "bodyMediaType": "application/json"
    },
    "responses": [
      {
        "status": 201,
        "mediaType": "application/json",
        "schema": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "object",
          "description": "One workspace as its member sees it.",
          "additionalProperties": false,
          "required": [
            "workspaceId",
            "name",
            "role",
            "personal"
          ],
          "properties": {
            "workspaceId": {
              "allOf": [
                {
                  "type": "string",
                  "description": "A UUID that names one record.",
                  "format": "uuid",
                  "minLength": 36,
                  "maxLength": 36,
                  "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
                }
              ],
              "readOnly": true,
              "description": "Identifier of the workspace."
            },
            "name": {
              "type": "string",
              "readOnly": true,
              "description": "Name of the workspace.",
              "minLength": 1,
              "maxLength": 200
            },
            "role": {
              "allOf": [
                {
                  "type": "string",
                  "description": "Workspace membership role. A viewer reads, an editor also writes, an administrator also manages membership and shares, and the owner also purges and transfers the workspace.",
                  "enum": [
                    "owner",
                    "admin",
                    "editor",
                    "viewer"
                  ]
                }
              ],
              "readOnly": true,
              "description": "The role of the reading account in this workspace."
            },
            "personal": {
              "type": "boolean",
              "readOnly": true,
              "description": "True for the workspace that was created with the account."
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
        "status": 401,
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
        "status": 403,
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
        "status": 413,
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
        "status": 415,
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
    "id": "deleteWorkspace",
    "method": "delete",
    "path": "/api/workspaces/{workspaceId}",
    "protocol": null,
    "security": [
      {
        "sessionCookie": []
      },
      {
        "agentToken": []
      }
    ],
    "parameters": [
      {
        "name": "x-request-id",
        "location": "header",
        "required": false,
        "style": "simple",
        "explode": false
      },
      {
        "name": "workspaceId",
        "location": "path",
        "required": true,
        "style": "simple",
        "explode": false
      }
    ],
    "request": {
      "params": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "workspaceId": {
            "type": "string",
            "description": "A UUID that names one record.",
            "format": "uuid",
            "minLength": 36,
            "maxLength": 36,
            "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
          }
        },
        "required": [
          "workspaceId"
        ],
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
          "description": "Confirmation that the named record no longer exists.",
          "additionalProperties": false,
          "required": [
            "removed"
          ],
          "properties": {
            "removed": {
              "type": "boolean",
              "readOnly": true,
              "description": "Always true. The record no longer exists."
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
        "status": 401,
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
        "status": 403,
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
        "status": 404,
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
    "id": "getAccount",
    "method": "get",
    "path": "/api/account",
    "protocol": null,
    "security": [
      {
        "sessionCookie": []
      },
      {
        "agentToken": []
      }
    ],
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
          "description": "The signed in account and its settings.",
          "additionalProperties": false,
          "required": [
            "accountId",
            "preferences"
          ],
          "properties": {
            "accountId": {
              "allOf": [
                {
                  "type": "string",
                  "description": "A UUID that names one record.",
                  "format": "uuid",
                  "minLength": 36,
                  "maxLength": 36,
                  "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
                }
              ],
              "readOnly": true,
              "description": "Stable identifier of the account inside this deployment."
            },
            "email": {
              "type": [
                "string",
                "null"
              ],
              "readOnly": true,
              "description": "Sign-in address, or null when the transport is an agent token.",
              "maxLength": 320
            },
            "name": {
              "type": [
                "string",
                "null"
              ],
              "readOnly": true,
              "description": "Display name, or null when the transport is an agent token.",
              "maxLength": 256
            },
            "preferences": {
              "allOf": [
                {
                  "type": "object",
                  "description": "Settings that follow one account to every device.",
                  "additionalProperties": false,
                  "required": [
                    "theme"
                  ],
                  "properties": {
                    "theme": {
                      "allOf": [
                        {
                          "type": "string",
                          "description": "Palette choice. The value system follows the device preference between the Tokyo Night Day and Night palettes.",
                          "enum": [
                            "system",
                            "light",
                            "dark"
                          ]
                        }
                      ],
                      "readOnly": true,
                      "description": "The stored palette choice of the account."
                    }
                  }
                }
              ],
              "readOnly": true,
              "description": "The stored settings of the account."
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
        "status": 401,
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
        "status": 403,
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
    "id": "getAuthSession",
    "method": "get",
    "path": "/api/auth/get-session",
    "protocol": "better-auth",
    "security": [],
    "parameters": [],
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
        "properties": {}
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
          "type": [
            "object",
            "null"
          ],
          "description": "The current session, or null when there is none.",
          "additionalProperties": true,
          "properties": {
            "user": {
              "type": "object",
              "description": "The signed in user as the identity provider reports it.",
              "additionalProperties": true,
              "required": [
                "id",
                "email"
              ],
              "properties": {
                "id": {
                  "type": "string",
                  "readOnly": true,
                  "description": "Identifier of the user inside the identity provider.",
                  "minLength": 1,
                  "maxLength": 128
                },
                "email": {
                  "type": "string",
                  "readOnly": true,
                  "description": "Sign-in address of the user.",
                  "maxLength": 320
                },
                "name": {
                  "type": "string",
                  "readOnly": true,
                  "description": "Display name of the user.",
                  "maxLength": 256
                },
                "emailVerified": {
                  "type": "boolean",
                  "readOnly": true,
                  "description": "Whether the provider reported the address as verified."
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
        "status": 401,
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
        "status": 429,
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
    "id": "getHealth",
    "method": "get",
    "path": "/api/health",
    "protocol": null,
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
    "protocol": null,
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
  },
  {
    "id": "inviteMember",
    "method": "post",
    "path": "/api/workspaces/{workspaceId}/members",
    "protocol": null,
    "security": [
      {
        "sessionCookie": []
      },
      {
        "agentToken": []
      }
    ],
    "parameters": [
      {
        "name": "x-request-id",
        "location": "header",
        "required": false,
        "style": "simple",
        "explode": false
      },
      {
        "name": "workspaceId",
        "location": "path",
        "required": true,
        "style": "simple",
        "explode": false
      }
    ],
    "request": {
      "params": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "workspaceId": {
            "type": "string",
            "description": "A UUID that names one record.",
            "format": "uuid",
            "minLength": 36,
            "maxLength": 36,
            "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
          }
        },
        "required": [
          "workspaceId"
        ],
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
      "body": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "description": "The address and the role of a new invitation.",
        "additionalProperties": false,
        "required": [
          "email",
          "role"
        ],
        "properties": {
          "email": {
            "type": "string",
            "description": "Address that may accept the invitation.",
            "format": "email",
            "minLength": 3,
            "maxLength": 320
          },
          "role": {
            "allOf": [
              {
                "type": "string",
                "description": "A role that an invitation or a role change may grant. The owner role is not in this list, because ownership moves only through an explicit transfer.",
                "enum": [
                  "admin",
                  "editor",
                  "viewer"
                ]
              }
            ],
            "description": "Role that acceptance grants."
          }
        }
      },
      "bodyMediaType": "application/json"
    },
    "responses": [
      {
        "status": 201,
        "mediaType": "application/json",
        "schema": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "object",
          "description": "A new invitation and its token, which is shown once.",
          "additionalProperties": false,
          "required": [
            "invitation",
            "token"
          ],
          "properties": {
            "invitation": {
              "allOf": [
                {
                  "type": "object",
                  "description": "One invitation to one workspace. The token itself is never stored.",
                  "additionalProperties": false,
                  "required": [
                    "id",
                    "workspaceId",
                    "email",
                    "role",
                    "expiresAt",
                    "state"
                  ],
                  "properties": {
                    "id": {
                      "allOf": [
                        {
                          "type": "string",
                          "description": "A UUID that names one record.",
                          "format": "uuid",
                          "minLength": 36,
                          "maxLength": 36,
                          "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
                        }
                      ],
                      "readOnly": true,
                      "description": "Identifier of the invitation."
                    },
                    "workspaceId": {
                      "allOf": [
                        {
                          "type": "string",
                          "description": "A UUID that names one record.",
                          "format": "uuid",
                          "minLength": 36,
                          "maxLength": 36,
                          "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
                        }
                      ],
                      "readOnly": true,
                      "description": "Workspace that the invitation admits to."
                    },
                    "email": {
                      "type": "string",
                      "readOnly": true,
                      "description": "Address that the invitation was created for.",
                      "maxLength": 320
                    },
                    "role": {
                      "allOf": [
                        {
                          "type": "string",
                          "description": "A role that an invitation or a role change may grant. The owner role is not in this list, because ownership moves only through an explicit transfer.",
                          "enum": [
                            "admin",
                            "editor",
                            "viewer"
                          ]
                        }
                      ],
                      "readOnly": true,
                      "description": "Role that acceptance grants."
                    },
                    "expiresAt": {
                      "type": "string",
                      "readOnly": true,
                      "description": "Instant after which the invitation cannot be accepted.",
                      "format": "date-time",
                      "maxLength": 64
                    },
                    "state": {
                      "type": "string",
                      "readOnly": true,
                      "description": "Whether the invitation is still open.",
                      "enum": [
                        "pending",
                        "accepted",
                        "revoked"
                      ]
                    }
                  }
                }
              ],
              "readOnly": true,
              "description": "The stored invitation."
            },
            "token": {
              "type": "string",
              "readOnly": true,
              "description": "The invitation token. It appears in this answer only, because storage keeps its hash.",
              "minLength": 32,
              "maxLength": 128
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
        "status": 401,
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
        "status": 403,
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
        "status": 404,
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
        "status": 413,
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
        "status": 415,
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
    "id": "listAgentTokens",
    "method": "get",
    "path": "/api/agent-tokens",
    "protocol": null,
    "security": [
      {
        "sessionCookie": []
      }
    ],
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
          "description": "Every agent token of the signed in account.",
          "additionalProperties": false,
          "required": [
            "tokens"
          ],
          "properties": {
            "tokens": {
              "type": "array",
              "readOnly": true,
              "description": "One entry for each token of the account.",
              "maxItems": 1000,
              "items": {
                "type": "object",
                "description": "One agent token without its secret.",
                "additionalProperties": false,
                "required": [
                  "id",
                  "name",
                  "prefix",
                  "scopes",
                  "expiresAt",
                  "createdAt"
                ],
                "properties": {
                  "id": {
                    "allOf": [
                      {
                        "type": "string",
                        "description": "A UUID that names one record.",
                        "format": "uuid",
                        "minLength": 36,
                        "maxLength": 36,
                        "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
                      }
                    ],
                    "readOnly": true,
                    "description": "Identifier of the token."
                  },
                  "name": {
                    "type": "string",
                    "readOnly": true,
                    "description": "Name that the account gave the token.",
                    "minLength": 1,
                    "maxLength": 200
                  },
                  "prefix": {
                    "type": "string",
                    "readOnly": true,
                    "description": "Public prefix of the secret, which names the token in a list.",
                    "minLength": 4,
                    "maxLength": 32
                  },
                  "scopes": {
                    "type": "array",
                    "readOnly": true,
                    "description": "The stored scope of the token.",
                    "minItems": 1,
                    "maxItems": 100,
                    "items": {
                      "type": "object",
                      "description": "The workspace and the actions that one agent token may use.",
                      "additionalProperties": false,
                      "required": [
                        "workspaceId",
                        "actions"
                      ],
                      "properties": {
                        "workspaceId": {
                          "allOf": [
                            {
                              "type": "string",
                              "description": "A UUID that names one record.",
                              "format": "uuid",
                              "minLength": 36,
                              "maxLength": 36,
                              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
                            }
                          ],
                          "description": "Workspace that the scope applies to."
                        },
                        "actions": {
                          "type": "array",
                          "description": "Actions that the token may perform in that workspace.",
                          "minItems": 1,
                          "maxItems": 6,
                          "items": {
                            "type": "string",
                            "description": "One permitted kind of operation inside one workspace.",
                            "enum": [
                              "read",
                              "write",
                              "history",
                              "share",
                              "members",
                              "purge"
                            ]
                          }
                        }
                      }
                    }
                  },
                  "expiresAt": {
                    "type": "string",
                    "readOnly": true,
                    "description": "Instant after which the token is refused.",
                    "format": "date-time",
                    "maxLength": 64
                  },
                  "createdAt": {
                    "type": "string",
                    "readOnly": true,
                    "description": "Instant at which the token was created.",
                    "format": "date-time",
                    "maxLength": 64
                  },
                  "revokedAt": {
                    "type": [
                      "string",
                      "null"
                    ],
                    "readOnly": true,
                    "description": "Instant at which the token was revoked, or null.",
                    "format": "date-time",
                    "maxLength": 64
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
        "status": 401,
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
        "status": 403,
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
    "id": "listMembers",
    "method": "get",
    "path": "/api/workspaces/{workspaceId}/members",
    "protocol": null,
    "security": [
      {
        "sessionCookie": []
      },
      {
        "agentToken": []
      }
    ],
    "parameters": [
      {
        "name": "x-request-id",
        "location": "header",
        "required": false,
        "style": "simple",
        "explode": false
      },
      {
        "name": "workspaceId",
        "location": "path",
        "required": true,
        "style": "simple",
        "explode": false
      }
    ],
    "request": {
      "params": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "workspaceId": {
            "type": "string",
            "description": "A UUID that names one record.",
            "format": "uuid",
            "minLength": 36,
            "maxLength": 36,
            "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
          }
        },
        "required": [
          "workspaceId"
        ],
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
          "description": "The members and the open invitations of one workspace.",
          "additionalProperties": false,
          "required": [
            "members",
            "invitations"
          ],
          "properties": {
            "members": {
              "type": "array",
              "readOnly": true,
              "description": "One entry for each member of the workspace.",
              "maxItems": 1000,
              "items": {
                "type": "object",
                "description": "One member of one workspace.",
                "additionalProperties": false,
                "required": [
                  "accountId",
                  "role"
                ],
                "properties": {
                  "accountId": {
                    "allOf": [
                      {
                        "type": "string",
                        "description": "A UUID that names one record.",
                        "format": "uuid",
                        "minLength": 36,
                        "maxLength": 36,
                        "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
                      }
                    ],
                    "readOnly": true,
                    "description": "Identifier of the member account."
                  },
                  "role": {
                    "allOf": [
                      {
                        "type": "string",
                        "description": "Workspace membership role. A viewer reads, an editor also writes, an administrator also manages membership and shares, and the owner also purges and transfers the workspace.",
                        "enum": [
                          "owner",
                          "admin",
                          "editor",
                          "viewer"
                        ]
                      }
                    ],
                    "readOnly": true,
                    "description": "Current role of the member."
                  },
                  "email": {
                    "type": [
                      "string",
                      "null"
                    ],
                    "readOnly": true,
                    "description": "Sign-in address of the member, or null when none is linked.",
                    "maxLength": 320
                  },
                  "name": {
                    "type": [
                      "string",
                      "null"
                    ],
                    "readOnly": true,
                    "description": "Display name of the member, or null when none is linked.",
                    "maxLength": 256
                  }
                }
              }
            },
            "invitations": {
              "type": "array",
              "readOnly": true,
              "description": "One entry for each invitation. The list is empty for a member that does not manage membership.",
              "maxItems": 1000,
              "items": {
                "type": "object",
                "description": "One invitation to one workspace. The token itself is never stored.",
                "additionalProperties": false,
                "required": [
                  "id",
                  "workspaceId",
                  "email",
                  "role",
                  "expiresAt",
                  "state"
                ],
                "properties": {
                  "id": {
                    "allOf": [
                      {
                        "type": "string",
                        "description": "A UUID that names one record.",
                        "format": "uuid",
                        "minLength": 36,
                        "maxLength": 36,
                        "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
                      }
                    ],
                    "readOnly": true,
                    "description": "Identifier of the invitation."
                  },
                  "workspaceId": {
                    "allOf": [
                      {
                        "type": "string",
                        "description": "A UUID that names one record.",
                        "format": "uuid",
                        "minLength": 36,
                        "maxLength": 36,
                        "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
                      }
                    ],
                    "readOnly": true,
                    "description": "Workspace that the invitation admits to."
                  },
                  "email": {
                    "type": "string",
                    "readOnly": true,
                    "description": "Address that the invitation was created for.",
                    "maxLength": 320
                  },
                  "role": {
                    "allOf": [
                      {
                        "type": "string",
                        "description": "A role that an invitation or a role change may grant. The owner role is not in this list, because ownership moves only through an explicit transfer.",
                        "enum": [
                          "admin",
                          "editor",
                          "viewer"
                        ]
                      }
                    ],
                    "readOnly": true,
                    "description": "Role that acceptance grants."
                  },
                  "expiresAt": {
                    "type": "string",
                    "readOnly": true,
                    "description": "Instant after which the invitation cannot be accepted.",
                    "format": "date-time",
                    "maxLength": 64
                  },
                  "state": {
                    "type": "string",
                    "readOnly": true,
                    "description": "Whether the invitation is still open.",
                    "enum": [
                      "pending",
                      "accepted",
                      "revoked"
                    ]
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
        "status": 401,
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
        "status": 403,
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
        "status": 404,
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
    "id": "listWorkspaces",
    "method": "get",
    "path": "/api/workspaces",
    "protocol": null,
    "security": [
      {
        "sessionCookie": []
      },
      {
        "agentToken": []
      }
    ],
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
          "description": "Every workspace of the signed in account.",
          "additionalProperties": false,
          "required": [
            "workspaces"
          ],
          "properties": {
            "workspaces": {
              "type": "array",
              "readOnly": true,
              "description": "One entry for each workspace the account belongs to.",
              "maxItems": 1000,
              "items": {
                "type": "object",
                "description": "One workspace as its member sees it.",
                "additionalProperties": false,
                "required": [
                  "workspaceId",
                  "name",
                  "role",
                  "personal"
                ],
                "properties": {
                  "workspaceId": {
                    "allOf": [
                      {
                        "type": "string",
                        "description": "A UUID that names one record.",
                        "format": "uuid",
                        "minLength": 36,
                        "maxLength": 36,
                        "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
                      }
                    ],
                    "readOnly": true,
                    "description": "Identifier of the workspace."
                  },
                  "name": {
                    "type": "string",
                    "readOnly": true,
                    "description": "Name of the workspace.",
                    "minLength": 1,
                    "maxLength": 200
                  },
                  "role": {
                    "allOf": [
                      {
                        "type": "string",
                        "description": "Workspace membership role. A viewer reads, an editor also writes, an administrator also manages membership and shares, and the owner also purges and transfers the workspace.",
                        "enum": [
                          "owner",
                          "admin",
                          "editor",
                          "viewer"
                        ]
                      }
                    ],
                    "readOnly": true,
                    "description": "The role of the reading account in this workspace."
                  },
                  "personal": {
                    "type": "boolean",
                    "readOnly": true,
                    "description": "True for the workspace that was created with the account."
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
        "status": 401,
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
        "status": 403,
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
    "id": "removeMember",
    "method": "delete",
    "path": "/api/workspaces/{workspaceId}/members/{accountId}",
    "protocol": null,
    "security": [
      {
        "sessionCookie": []
      },
      {
        "agentToken": []
      }
    ],
    "parameters": [
      {
        "name": "x-request-id",
        "location": "header",
        "required": false,
        "style": "simple",
        "explode": false
      },
      {
        "name": "workspaceId",
        "location": "path",
        "required": true,
        "style": "simple",
        "explode": false
      },
      {
        "name": "accountId",
        "location": "path",
        "required": true,
        "style": "simple",
        "explode": false
      }
    ],
    "request": {
      "params": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "workspaceId": {
            "type": "string",
            "description": "A UUID that names one record.",
            "format": "uuid",
            "minLength": 36,
            "maxLength": 36,
            "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
          },
          "accountId": {
            "type": "string",
            "description": "A UUID that names one record.",
            "format": "uuid",
            "minLength": 36,
            "maxLength": 36,
            "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
          }
        },
        "required": [
          "accountId",
          "workspaceId"
        ],
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
          "description": "Confirmation that the named record no longer exists.",
          "additionalProperties": false,
          "required": [
            "removed"
          ],
          "properties": {
            "removed": {
              "type": "boolean",
              "readOnly": true,
              "description": "Always true. The record no longer exists."
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
        "status": 401,
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
        "status": 403,
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
        "status": 404,
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
    "id": "requestPasswordReset",
    "method": "post",
    "path": "/api/auth/request-password-reset",
    "protocol": "better-auth",
    "security": [],
    "parameters": [],
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
        "properties": {}
      },
      "body": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "description": "The address that asks for a password reset message.",
        "additionalProperties": false,
        "required": [
          "email"
        ],
        "properties": {
          "email": {
            "type": "string",
            "description": "Sign-in address of the account.",
            "format": "email",
            "minLength": 3,
            "maxLength": 320
          },
          "redirectTo": {
            "type": "string",
            "description": "Address that the reset link opens.",
            "maxLength": 2048
          }
        }
      },
      "bodyMediaType": "application/json"
    },
    "responses": [
      {
        "status": 200,
        "mediaType": "application/json",
        "schema": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "object",
          "description": "Whether the protocol endpoint completed its work.",
          "additionalProperties": true,
          "required": [
            "status"
          ],
          "properties": {
            "status": {
              "type": "boolean",
              "readOnly": true,
              "description": "True when the endpoint completed its work."
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
        "status": 401,
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
        "status": 413,
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
        "status": 415,
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
        "status": 429,
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
    "id": "resetPassword",
    "method": "post",
    "path": "/api/auth/reset-password",
    "protocol": "better-auth",
    "security": [],
    "parameters": [],
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
        "properties": {}
      },
      "body": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "description": "The new password and the token from the reset message.",
        "additionalProperties": false,
        "required": [
          "newPassword"
        ],
        "properties": {
          "newPassword": {
            "type": "string",
            "description": "New password of the account.",
            "minLength": 12,
            "maxLength": 512
          },
          "token": {
            "type": "string",
            "description": "Token from the reset message.",
            "minLength": 1,
            "maxLength": 512
          }
        }
      },
      "bodyMediaType": "application/json"
    },
    "responses": [
      {
        "status": 200,
        "mediaType": "application/json",
        "schema": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "object",
          "description": "Whether the protocol endpoint completed its work.",
          "additionalProperties": true,
          "required": [
            "status"
          ],
          "properties": {
            "status": {
              "type": "boolean",
              "readOnly": true,
              "description": "True when the endpoint completed its work."
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
        "status": 401,
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
        "status": 413,
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
        "status": 415,
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
        "status": 429,
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
    "id": "revokeAgentToken",
    "method": "delete",
    "path": "/api/agent-tokens/{tokenId}",
    "protocol": null,
    "security": [
      {
        "sessionCookie": []
      }
    ],
    "parameters": [
      {
        "name": "x-request-id",
        "location": "header",
        "required": false,
        "style": "simple",
        "explode": false
      },
      {
        "name": "tokenId",
        "location": "path",
        "required": true,
        "style": "simple",
        "explode": false
      }
    ],
    "request": {
      "params": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "tokenId": {
            "type": "string",
            "description": "A UUID that names one record.",
            "format": "uuid",
            "minLength": 36,
            "maxLength": 36,
            "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
          }
        },
        "required": [
          "tokenId"
        ],
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
          "description": "Confirmation that the named record no longer exists.",
          "additionalProperties": false,
          "required": [
            "removed"
          ],
          "properties": {
            "removed": {
              "type": "boolean",
              "readOnly": true,
              "description": "Always true. The record no longer exists."
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
        "status": 401,
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
        "status": 403,
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
        "status": 404,
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
    "id": "signInWithPassword",
    "method": "post",
    "path": "/api/auth/sign-in/email",
    "protocol": "better-auth",
    "security": [],
    "parameters": [],
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
        "properties": {}
      },
      "body": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "description": "Address and password of a local account.",
        "additionalProperties": false,
        "required": [
          "email",
          "password"
        ],
        "properties": {
          "email": {
            "type": "string",
            "description": "Sign-in address of the account.",
            "format": "email",
            "minLength": 3,
            "maxLength": 320
          },
          "password": {
            "type": "string",
            "description": "Password of the account.",
            "minLength": 1,
            "maxLength": 512
          },
          "rememberMe": {
            "type": "boolean",
            "description": "Whether the session survives a browser restart."
          },
          "callbackURL": {
            "type": "string",
            "description": "Address to open after a completed sign-in.",
            "maxLength": 2048
          }
        }
      },
      "bodyMediaType": "application/json"
    },
    "responses": [
      {
        "status": 200,
        "mediaType": "application/json",
        "schema": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "object",
          "description": "The result of a completed sign-in.",
          "additionalProperties": true,
          "required": [
            "redirect"
          ],
          "properties": {
            "redirect": {
              "type": "boolean",
              "readOnly": true,
              "description": "Whether the caller should follow a redirect."
            },
            "token": {
              "type": "string",
              "readOnly": true,
              "description": "Session token. The session cookie carries it as well.",
              "maxLength": 512
            },
            "url": {
              "type": "string",
              "readOnly": true,
              "description": "Address to open, when the answer asks for a redirect.",
              "maxLength": 2048
            },
            "user": {
              "type": "object",
              "description": "The signed in user as the identity provider reports it.",
              "additionalProperties": true,
              "required": [
                "id",
                "email"
              ],
              "properties": {
                "id": {
                  "type": "string",
                  "readOnly": true,
                  "description": "Identifier of the user inside the identity provider.",
                  "minLength": 1,
                  "maxLength": 128
                },
                "email": {
                  "type": "string",
                  "readOnly": true,
                  "description": "Sign-in address of the user.",
                  "maxLength": 320
                },
                "name": {
                  "type": "string",
                  "readOnly": true,
                  "description": "Display name of the user.",
                  "maxLength": 256
                },
                "emailVerified": {
                  "type": "boolean",
                  "readOnly": true,
                  "description": "Whether the provider reported the address as verified."
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
        "status": 401,
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
        "status": 413,
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
        "status": 415,
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
        "status": 429,
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
    "id": "signInWithProvider",
    "method": "post",
    "path": "/api/auth/sign-in/social",
    "protocol": "better-auth",
    "security": [],
    "parameters": [],
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
        "properties": {}
      },
      "body": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "description": "The configured provider to sign in with.",
        "additionalProperties": false,
        "required": [
          "provider"
        ],
        "properties": {
          "provider": {
            "type": "string",
            "description": "Identifier of the configured provider.",
            "minLength": 1,
            "maxLength": 64
          },
          "callbackURL": {
            "type": "string",
            "description": "Address to open after a completed sign-in.",
            "maxLength": 2048
          },
          "errorCallbackURL": {
            "type": "string",
            "description": "Address to open after a refused sign-in.",
            "maxLength": 2048
          },
          "newUserCallbackURL": {
            "type": "string",
            "description": "Address to open after a first sign-in.",
            "maxLength": 2048
          }
        }
      },
      "bodyMediaType": "application/json"
    },
    "responses": [
      {
        "status": 200,
        "mediaType": "application/json",
        "schema": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "object",
          "description": "The provider address that the browser must open.",
          "additionalProperties": true,
          "required": [
            "redirect"
          ],
          "properties": {
            "redirect": {
              "type": "boolean",
              "readOnly": true,
              "description": "Whether the caller should follow the address below."
            },
            "url": {
              "type": "string",
              "readOnly": true,
              "description": "Authorization address of the configured provider.",
              "maxLength": 2048
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
        "status": 401,
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
        "status": 413,
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
        "status": 415,
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
        "status": 429,
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
    "id": "signOut",
    "method": "post",
    "path": "/api/auth/sign-out",
    "protocol": "better-auth",
    "security": [],
    "parameters": [],
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
        "properties": {}
      },
      "body": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "description": "Sign-out carries no data. The session cookie names it.",
        "additionalProperties": false,
        "properties": {}
      },
      "bodyMediaType": "application/json"
    },
    "responses": [
      {
        "status": 200,
        "mediaType": "application/json",
        "schema": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "object",
          "description": "Whether the protocol endpoint completed its work.",
          "additionalProperties": true,
          "required": [
            "status"
          ],
          "properties": {
            "status": {
              "type": "boolean",
              "readOnly": true,
              "description": "True when the endpoint completed its work."
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
        "status": 401,
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
        "status": 413,
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
        "status": 415,
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
        "status": 429,
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
    "id": "transferOwnership",
    "method": "post",
    "path": "/api/workspaces/{workspaceId}/ownership",
    "protocol": null,
    "security": [
      {
        "sessionCookie": []
      },
      {
        "agentToken": []
      }
    ],
    "parameters": [
      {
        "name": "x-request-id",
        "location": "header",
        "required": false,
        "style": "simple",
        "explode": false
      },
      {
        "name": "workspaceId",
        "location": "path",
        "required": true,
        "style": "simple",
        "explode": false
      }
    ],
    "request": {
      "params": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "workspaceId": {
            "type": "string",
            "description": "A UUID that names one record.",
            "format": "uuid",
            "minLength": 36,
            "maxLength": 36,
            "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
          }
        },
        "required": [
          "workspaceId"
        ],
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
      "body": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "description": "The member that becomes the owner of a workspace.",
        "additionalProperties": false,
        "required": [
          "accountId"
        ],
        "properties": {
          "accountId": {
            "allOf": [
              {
                "type": "string",
                "description": "A UUID that names one record.",
                "format": "uuid",
                "minLength": 36,
                "maxLength": 36,
                "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
              }
            ],
            "description": "Member that becomes the owner."
          },
          "leave": {
            "type": "boolean",
            "description": "When true, the old owner leaves the workspace instead of becoming an administrator."
          }
        }
      },
      "bodyMediaType": "application/json"
    },
    "responses": [
      {
        "status": 200,
        "mediaType": "application/json",
        "schema": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "object",
          "description": "The members and the open invitations of one workspace.",
          "additionalProperties": false,
          "required": [
            "members",
            "invitations"
          ],
          "properties": {
            "members": {
              "type": "array",
              "readOnly": true,
              "description": "One entry for each member of the workspace.",
              "maxItems": 1000,
              "items": {
                "type": "object",
                "description": "One member of one workspace.",
                "additionalProperties": false,
                "required": [
                  "accountId",
                  "role"
                ],
                "properties": {
                  "accountId": {
                    "allOf": [
                      {
                        "type": "string",
                        "description": "A UUID that names one record.",
                        "format": "uuid",
                        "minLength": 36,
                        "maxLength": 36,
                        "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
                      }
                    ],
                    "readOnly": true,
                    "description": "Identifier of the member account."
                  },
                  "role": {
                    "allOf": [
                      {
                        "type": "string",
                        "description": "Workspace membership role. A viewer reads, an editor also writes, an administrator also manages membership and shares, and the owner also purges and transfers the workspace.",
                        "enum": [
                          "owner",
                          "admin",
                          "editor",
                          "viewer"
                        ]
                      }
                    ],
                    "readOnly": true,
                    "description": "Current role of the member."
                  },
                  "email": {
                    "type": [
                      "string",
                      "null"
                    ],
                    "readOnly": true,
                    "description": "Sign-in address of the member, or null when none is linked.",
                    "maxLength": 320
                  },
                  "name": {
                    "type": [
                      "string",
                      "null"
                    ],
                    "readOnly": true,
                    "description": "Display name of the member, or null when none is linked.",
                    "maxLength": 256
                  }
                }
              }
            },
            "invitations": {
              "type": "array",
              "readOnly": true,
              "description": "One entry for each invitation. The list is empty for a member that does not manage membership.",
              "maxItems": 1000,
              "items": {
                "type": "object",
                "description": "One invitation to one workspace. The token itself is never stored.",
                "additionalProperties": false,
                "required": [
                  "id",
                  "workspaceId",
                  "email",
                  "role",
                  "expiresAt",
                  "state"
                ],
                "properties": {
                  "id": {
                    "allOf": [
                      {
                        "type": "string",
                        "description": "A UUID that names one record.",
                        "format": "uuid",
                        "minLength": 36,
                        "maxLength": 36,
                        "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
                      }
                    ],
                    "readOnly": true,
                    "description": "Identifier of the invitation."
                  },
                  "workspaceId": {
                    "allOf": [
                      {
                        "type": "string",
                        "description": "A UUID that names one record.",
                        "format": "uuid",
                        "minLength": 36,
                        "maxLength": 36,
                        "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
                      }
                    ],
                    "readOnly": true,
                    "description": "Workspace that the invitation admits to."
                  },
                  "email": {
                    "type": "string",
                    "readOnly": true,
                    "description": "Address that the invitation was created for.",
                    "maxLength": 320
                  },
                  "role": {
                    "allOf": [
                      {
                        "type": "string",
                        "description": "A role that an invitation or a role change may grant. The owner role is not in this list, because ownership moves only through an explicit transfer.",
                        "enum": [
                          "admin",
                          "editor",
                          "viewer"
                        ]
                      }
                    ],
                    "readOnly": true,
                    "description": "Role that acceptance grants."
                  },
                  "expiresAt": {
                    "type": "string",
                    "readOnly": true,
                    "description": "Instant after which the invitation cannot be accepted.",
                    "format": "date-time",
                    "maxLength": 64
                  },
                  "state": {
                    "type": "string",
                    "readOnly": true,
                    "description": "Whether the invitation is still open.",
                    "enum": [
                      "pending",
                      "accepted",
                      "revoked"
                    ]
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
        "status": 401,
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
        "status": 403,
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
        "status": 404,
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
        "status": 413,
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
        "status": 415,
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
    "id": "updateMember",
    "method": "put",
    "path": "/api/workspaces/{workspaceId}/members/{accountId}",
    "protocol": null,
    "security": [
      {
        "sessionCookie": []
      },
      {
        "agentToken": []
      }
    ],
    "parameters": [
      {
        "name": "x-request-id",
        "location": "header",
        "required": false,
        "style": "simple",
        "explode": false
      },
      {
        "name": "workspaceId",
        "location": "path",
        "required": true,
        "style": "simple",
        "explode": false
      },
      {
        "name": "accountId",
        "location": "path",
        "required": true,
        "style": "simple",
        "explode": false
      }
    ],
    "request": {
      "params": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "workspaceId": {
            "type": "string",
            "description": "A UUID that names one record.",
            "format": "uuid",
            "minLength": 36,
            "maxLength": 36,
            "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
          },
          "accountId": {
            "type": "string",
            "description": "A UUID that names one record.",
            "format": "uuid",
            "minLength": 36,
            "maxLength": 36,
            "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
          }
        },
        "required": [
          "accountId",
          "workspaceId"
        ],
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
      "body": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "description": "The role to give a member.",
        "additionalProperties": false,
        "required": [
          "role"
        ],
        "properties": {
          "role": {
            "allOf": [
              {
                "type": "string",
                "description": "A role that an invitation or a role change may grant. The owner role is not in this list, because ownership moves only through an explicit transfer.",
                "enum": [
                  "admin",
                  "editor",
                  "viewer"
                ]
              }
            ],
            "description": "New role of the member."
          }
        }
      },
      "bodyMediaType": "application/json"
    },
    "responses": [
      {
        "status": 200,
        "mediaType": "application/json",
        "schema": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "object",
          "description": "One member of one workspace.",
          "additionalProperties": false,
          "required": [
            "accountId",
            "role"
          ],
          "properties": {
            "accountId": {
              "allOf": [
                {
                  "type": "string",
                  "description": "A UUID that names one record.",
                  "format": "uuid",
                  "minLength": 36,
                  "maxLength": 36,
                  "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
                }
              ],
              "readOnly": true,
              "description": "Identifier of the member account."
            },
            "role": {
              "allOf": [
                {
                  "type": "string",
                  "description": "Workspace membership role. A viewer reads, an editor also writes, an administrator also manages membership and shares, and the owner also purges and transfers the workspace.",
                  "enum": [
                    "owner",
                    "admin",
                    "editor",
                    "viewer"
                  ]
                }
              ],
              "readOnly": true,
              "description": "Current role of the member."
            },
            "email": {
              "type": [
                "string",
                "null"
              ],
              "readOnly": true,
              "description": "Sign-in address of the member, or null when none is linked.",
              "maxLength": 320
            },
            "name": {
              "type": [
                "string",
                "null"
              ],
              "readOnly": true,
              "description": "Display name of the member, or null when none is linked.",
              "maxLength": 256
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
        "status": 401,
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
        "status": 403,
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
        "status": 404,
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
        "status": 413,
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
        "status": 415,
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
    "id": "updatePreferences",
    "method": "put",
    "path": "/api/account/preferences",
    "protocol": null,
    "security": [
      {
        "sessionCookie": []
      }
    ],
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
      "body": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "description": "Settings to store for the signed in account.",
        "additionalProperties": false,
        "required": [
          "theme"
        ],
        "properties": {
          "theme": {
            "allOf": [
              {
                "type": "string",
                "description": "Palette choice. The value system follows the device preference between the Tokyo Night Day and Night palettes.",
                "enum": [
                  "system",
                  "light",
                  "dark"
                ]
              }
            ],
            "description": "The palette choice to store."
          }
        }
      },
      "bodyMediaType": "application/json"
    },
    "responses": [
      {
        "status": 200,
        "mediaType": "application/json",
        "schema": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "object",
          "description": "Settings that follow one account to every device.",
          "additionalProperties": false,
          "required": [
            "theme"
          ],
          "properties": {
            "theme": {
              "allOf": [
                {
                  "type": "string",
                  "description": "Palette choice. The value system follows the device preference between the Tokyo Night Day and Night palettes.",
                  "enum": [
                    "system",
                    "light",
                    "dark"
                  ]
                }
              ],
              "readOnly": true,
              "description": "The stored palette choice of the account."
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
        "status": 401,
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
        "status": 403,
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
        "status": 413,
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
        "status": 415,
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
    "id": "updateWorkspace",
    "method": "put",
    "path": "/api/workspaces/{workspaceId}",
    "protocol": null,
    "security": [
      {
        "sessionCookie": []
      },
      {
        "agentToken": []
      }
    ],
    "parameters": [
      {
        "name": "x-request-id",
        "location": "header",
        "required": false,
        "style": "simple",
        "explode": false
      },
      {
        "name": "workspaceId",
        "location": "path",
        "required": true,
        "style": "simple",
        "explode": false
      }
    ],
    "request": {
      "params": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "workspaceId": {
            "type": "string",
            "description": "A UUID that names one record.",
            "format": "uuid",
            "minLength": 36,
            "maxLength": 36,
            "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
          }
        },
        "required": [
          "workspaceId"
        ],
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
      "body": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "description": "The name to give a workspace.",
        "additionalProperties": false,
        "required": [
          "name"
        ],
        "properties": {
          "name": {
            "type": "string",
            "description": "Name of the workspace.",
            "minLength": 1,
            "maxLength": 200
          }
        }
      },
      "bodyMediaType": "application/json"
    },
    "responses": [
      {
        "status": 200,
        "mediaType": "application/json",
        "schema": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "object",
          "description": "One workspace as its member sees it.",
          "additionalProperties": false,
          "required": [
            "workspaceId",
            "name",
            "role",
            "personal"
          ],
          "properties": {
            "workspaceId": {
              "allOf": [
                {
                  "type": "string",
                  "description": "A UUID that names one record.",
                  "format": "uuid",
                  "minLength": 36,
                  "maxLength": 36,
                  "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
                }
              ],
              "readOnly": true,
              "description": "Identifier of the workspace."
            },
            "name": {
              "type": "string",
              "readOnly": true,
              "description": "Name of the workspace.",
              "minLength": 1,
              "maxLength": 200
            },
            "role": {
              "allOf": [
                {
                  "type": "string",
                  "description": "Workspace membership role. A viewer reads, an editor also writes, an administrator also manages membership and shares, and the owner also purges and transfers the workspace.",
                  "enum": [
                    "owner",
                    "admin",
                    "editor",
                    "viewer"
                  ]
                }
              ],
              "readOnly": true,
              "description": "The role of the reading account in this workspace."
            },
            "personal": {
              "type": "boolean",
              "readOnly": true,
              "description": "True for the workspace that was created with the account."
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
        "status": 401,
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
        "status": 403,
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
        "status": 404,
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
        "status": 413,
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
        "status": 415,
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
  }
];
