// Contract domain: the contract and its e-signature envelope.

export interface Contract {
  contractId: string;
  envelopeId?: string;
  signingUrl?: string;
}
