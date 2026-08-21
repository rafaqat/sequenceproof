import { SequenceProofError } from "../errors.js";

/** Base client-side protocol error. */
export class ProtocolError extends SequenceProofError {}
/** Remote protocol major version is unsupported. */
export class ProtocolVersionError extends ProtocolError {}
/** Adapter manifest or digest does not match the expected contract. */
export class ManifestMismatchError extends ProtocolError {}
/** Validated problem response returned by the Rails engine. */
export class RemoteProblemError extends ProtocolError {}
