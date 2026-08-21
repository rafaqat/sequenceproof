// Generated from ../../../../schemas by scripts/sync-schemas.mjs. Do not edit.
export const schemas = {
  "manifest-v1": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:sequenceproof:schema:manifest:v1",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "protocol",
      "protocol_version",
      "request_id",
      "sequenceproof_rails_version",
      "supported_protocol_versions",
      "adapter",
      "commands",
      "observation_schema",
      "server_invariants",
      "isolation",
      "digest"
    ],
    "properties": {
      "protocol": {
        "const": "sequenceproof.protocol"
      },
      "protocol_version": {
        "const": 1
      },
      "request_id": {
        "type": "string",
        "minLength": 1
      },
      "sequenceproof_rails_version": {
        "type": "string",
        "minLength": 1
      },
      "supported_protocol_versions": {
        "const": [
          1
        ]
      },
      "adapter": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "name",
          "version"
        ],
        "properties": {
          "name": {
            "$ref": "#/$defs/identifier"
          },
          "version": {
            "type": "integer",
            "minimum": 1
          }
        }
      },
      "commands": {
        "type": "array",
        "minItems": 1,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "id",
            "actors",
            "input_schema",
            "output_schema",
            "metadata"
          ],
          "properties": {
            "id": {
              "$ref": "#/$defs/identifier"
            },
            "actors": {
              "type": "array",
              "minItems": 1,
              "items": {
                "$ref": "#/$defs/identifier"
              },
              "uniqueItems": true
            },
            "input_schema": {
              "type": "object"
            },
            "output_schema": {
              "type": "object"
            },
            "metadata": {
              "type": "object"
            }
          }
        }
      },
      "observation_schema": {
        "type": "object"
      },
      "server_invariants": {
        "type": "array",
        "items": {
          "$ref": "#/$defs/identifier"
        },
        "uniqueItems": true
      },
      "isolation": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mode",
          "resettable"
        ],
        "properties": {
          "mode": {
            "enum": [
              "transaction",
              "callback"
            ]
          },
          "resettable": {
            "const": true
          }
        }
      },
      "digest": {
        "type": "string",
        "pattern": "^[a-f0-9]{64}$"
      }
    },
    "$defs": {
      "identifier": {
        "type": "string",
        "pattern": "^[a-z0-9][a-z0-9_.-]{0,127}$"
      }
    }
  },
  "problem-v1": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:sequenceproof:schema:problem:v1",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "type",
      "title",
      "status",
      "code",
      "request_id"
    ],
    "properties": {
      "type": {
        "type": "string"
      },
      "title": {
        "type": "string"
      },
      "status": {
        "type": "integer",
        "minimum": 100,
        "maximum": 599
      },
      "code": {
        "$ref": "#/$defs/identifier"
      },
      "detail": {
        "type": "string"
      },
      "request_id": {
        "type": "string",
        "minLength": 1,
        "maxLength": 128
      },
      "errors": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "path",
            "code",
            "message"
          ],
          "properties": {
            "path": {
              "type": "string"
            },
            "code": {
              "$ref": "#/$defs/identifier"
            },
            "message": {
              "type": "string"
            }
          }
        }
      }
    },
    "$defs": {
      "identifier": {
        "type": "string",
        "pattern": "^[a-z0-9][a-z0-9_.-]{0,127}$"
      }
    }
  },
  "protocol-v1": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:sequenceproof:schema:protocol:v1",
    "$defs": {
      "json": {
        "oneOf": [
          {
            "type": "null"
          },
          {
            "type": "boolean"
          },
          {
            "type": "number"
          },
          {
            "type": "string"
          },
          {
            "type": "array",
            "items": {
              "$ref": "#/$defs/json"
            }
          },
          {
            "type": "object",
            "additionalProperties": {
              "$ref": "#/$defs/json"
            }
          }
        ]
      },
      "identifier": {
        "type": "string",
        "pattern": "^[a-z0-9][a-z0-9_.-]{0,127}$"
      },
      "assertion_result": {
        "oneOf": [
          {
            "type": "boolean"
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "pass"
            ],
            "properties": {
              "pass": {
                "const": true
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "pass",
              "message"
            ],
            "properties": {
              "pass": {
                "const": false
              },
              "message": {
                "type": "string"
              },
              "expected": {
                "$ref": "#/$defs/json"
              },
              "actual": {
                "$ref": "#/$defs/json"
              },
              "path": {
                "type": "string"
              }
            }
          }
        ]
      },
      "assertion": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "name",
          "result"
        ],
        "properties": {
          "name": {
            "$ref": "#/$defs/identifier"
          },
          "result": {
            "$ref": "#/$defs/assertion_result"
          }
        }
      },
      "outcome": {
        "oneOf": [
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "status",
              "value"
            ],
            "properties": {
              "status": {
                "const": "ok"
              },
              "value": {
                "$ref": "#/$defs/json"
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "status",
              "code"
            ],
            "properties": {
              "status": {
                "const": "rejected"
              },
              "code": {
                "$ref": "#/$defs/identifier"
              },
              "value": {
                "$ref": "#/$defs/json"
              }
            }
          }
        ]
      },
      "envelope": {
        "type": "object",
        "required": [
          "protocol",
          "protocol_version",
          "request_id"
        ],
        "properties": {
          "protocol": {
            "const": "sequenceproof.protocol"
          },
          "protocol_version": {
            "const": 1
          },
          "request_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          }
        }
      },
      "run_fields": {
        "type": "object",
        "required": [
          "run_id",
          "observation",
          "assertions"
        ],
        "properties": {
          "run_id": {
            "$ref": "#/$defs/identifier"
          },
          "observation": {
            "$ref": "#/$defs/json"
          },
          "assertions": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/assertion"
            }
          }
        }
      },
      "run_response": {
        "type": "object",
        "allOf": [
          {
            "$ref": "#/$defs/envelope"
          },
          {
            "$ref": "#/$defs/run_fields"
          }
        ],
        "unevaluatedProperties": false
      },
      "command_response": {
        "type": "object",
        "allOf": [
          {
            "$ref": "#/$defs/envelope"
          },
          {
            "$ref": "#/$defs/run_fields"
          },
          {
            "type": "object",
            "required": [
              "outcome"
            ],
            "properties": {
              "outcome": {
                "$ref": "#/$defs/outcome"
              }
            }
          }
        ],
        "unevaluatedProperties": false
      }
    },
    "oneOf": [
      {
        "$ref": "#/$defs/run_response"
      },
      {
        "$ref": "#/$defs/command_response"
      }
    ]
  },
  "trace-v1": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:sequenceproof:schema:trace:v1",
    "$defs": {
      "json": {
        "oneOf": [
          {
            "type": "null"
          },
          {
            "type": "boolean"
          },
          {
            "type": "number"
          },
          {
            "type": "string"
          },
          {
            "type": "array",
            "items": {
              "$ref": "#/$defs/json"
            }
          },
          {
            "type": "object",
            "additionalProperties": {
              "$ref": "#/$defs/json"
            }
          }
        ]
      },
      "identifier": {
        "type": "string",
        "pattern": "^[a-z0-9][a-z0-9_.-]{0,127}$"
      },
      "assertion_result": {
        "oneOf": [
          {
            "type": "boolean"
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "pass"
            ],
            "properties": {
              "pass": {
                "const": true
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "pass",
              "message"
            ],
            "properties": {
              "pass": {
                "const": false
              },
              "message": {
                "type": "string"
              },
              "expected": {
                "$ref": "#/$defs/json"
              },
              "actual": {
                "$ref": "#/$defs/json"
              },
              "path": {
                "type": "string"
              }
            }
          }
        ]
      },
      "driver_assertion": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "name",
          "result"
        ],
        "properties": {
          "name": {
            "$ref": "#/$defs/identifier"
          },
          "result": {
            "$ref": "#/$defs/assertion_result"
          }
        }
      },
      "outcome": {
        "oneOf": [
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "status",
              "value"
            ],
            "properties": {
              "status": {
                "const": "ok"
              },
              "value": {
                "$ref": "#/$defs/json"
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "status",
              "code"
            ],
            "properties": {
              "status": {
                "const": "rejected"
              },
              "code": {
                "$ref": "#/$defs/identifier"
              },
              "value": {
                "$ref": "#/$defs/json"
              }
            }
          }
        ]
      },
      "property": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "kind",
          "name",
          "result"
        ],
        "properties": {
          "kind": {
            "enum": [
              "invariant",
              "postcondition",
              "server_invariant"
            ]
          },
          "name": {
            "$ref": "#/$defs/identifier"
          },
          "result": {
            "$ref": "#/$defs/assertion_result"
          }
        }
      },
      "failure": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "kind",
          "message"
        ],
        "properties": {
          "kind": {
            "enum": [
              "invariant",
              "postcondition",
              "server_invariant",
              "driver",
              "generator",
              "decoder",
              "timeout"
            ]
          },
          "name": {
            "$ref": "#/$defs/identifier"
          },
          "message": {
            "type": "string"
          },
          "step": {
            "type": "integer",
            "minimum": 0
          },
          "assertion": {
            "$ref": "#/$defs/assertion_result"
          }
        }
      },
      "step": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "step",
          "command",
          "target",
          "actor",
          "input",
          "outcome",
          "model_before",
          "model_after",
          "observation_before",
          "observation_after",
          "properties"
        ],
        "properties": {
          "step": {
            "type": "integer",
            "minimum": 0
          },
          "command": {
            "$ref": "#/$defs/identifier"
          },
          "target": {
            "$ref": "#/$defs/identifier"
          },
          "actor": {
            "$ref": "#/$defs/identifier"
          },
          "input": {
            "$ref": "#/$defs/json"
          },
          "outcome": {
            "$ref": "#/$defs/outcome"
          },
          "model_before": {
            "$ref": "#/$defs/json"
          },
          "model_after": {
            "$ref": "#/$defs/json"
          },
          "observation_before": {
            "$ref": "#/$defs/json"
          },
          "observation_after": {
            "$ref": "#/$defs/json"
          },
          "properties": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/property"
            }
          }
        }
      }
    },
    "type": "object",
    "additionalProperties": false,
    "required": [
      "schema",
      "protocol_version",
      "core_version",
      "model",
      "adapter",
      "run",
      "status",
      "initial",
      "steps"
    ],
    "properties": {
      "schema": {
        "const": "urn:sequenceproof:schema:trace:v1"
      },
      "protocol_version": {
        "const": 1
      },
      "core_version": {
        "type": "string",
        "minLength": 1
      },
      "model": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "name",
          "version"
        ],
        "properties": {
          "name": {
            "$ref": "#/$defs/identifier"
          },
          "version": {
            "type": "integer",
            "minimum": 1
          }
        }
      },
      "adapter": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "name",
          "version",
          "manifest_digest"
        ],
        "properties": {
          "name": {
            "$ref": "#/$defs/identifier"
          },
          "version": {
            "type": "integer",
            "minimum": 1
          },
          "manifest_digest": {
            "type": "string",
            "minLength": 1
          }
        }
      },
      "run": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "seed",
          "options",
          "metadata"
        ],
        "properties": {
          "id": {
            "$ref": "#/$defs/identifier"
          },
          "seed": {
            "type": "string"
          },
          "options": {
            "type": "object",
            "additionalProperties": {
              "$ref": "#/$defs/json"
            }
          },
          "metadata": {
            "type": "object",
            "additionalProperties": {
              "$ref": "#/$defs/json"
            }
          }
        }
      },
      "status": {
        "enum": [
          "passed",
          "failed",
          "errored",
          "exhausted",
          "aborted",
          "replay_diverged"
        ]
      },
      "initial": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "model",
          "observation",
          "properties"
        ],
        "properties": {
          "model": {
            "$ref": "#/$defs/json"
          },
          "observation": {
            "$ref": "#/$defs/json"
          },
          "properties": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/driver_assertion"
            }
          }
        }
      },
      "steps": {
        "type": "array",
        "items": {
          "$ref": "#/$defs/step"
        }
      },
      "failure": {
        "$ref": "#/$defs/failure"
      },
      "shrink": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "attempted",
          "complete",
          "original_steps",
          "minimal_steps"
        ],
        "properties": {
          "attempted": {
            "type": "integer",
            "minimum": 0
          },
          "complete": {
            "type": "boolean"
          },
          "original_steps": {
            "type": "integer",
            "minimum": 0
          },
          "minimal_steps": {
            "type": "integer",
            "minimum": 0
          }
        }
      },
      "diagnostics": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "started_at",
          "duration_ms"
        ],
        "properties": {
          "started_at": {
            "type": "string",
            "minLength": 1
          },
          "duration_ms": {
            "type": "number",
            "minimum": 0
          }
        }
      }
    }
  }
} as const;
