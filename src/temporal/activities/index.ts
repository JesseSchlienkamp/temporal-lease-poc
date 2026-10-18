// Activity registry for the worker, by domain. Named exports only: every export is registered
// as an activity, and activity names are global on the task queue.

// agentTask
export { completeAgentTask } from './agentTask/completeAgentTask.activity';
export { openAgentTask } from './agentTask/openAgentTask.activity';

// contract
export { createContract } from './contract/createContract.activity';
export { expireContract } from './contract/expireContract.activity';
export { requestSignature } from './contract/requestSignature.activity';

// credit
export { runCreditCheck } from './credit/runCreditCheck.activity';

// lead
export { qualifyLead } from './lead/qualifyLead.activity';
export { saveLead } from './lead/saveLead.activity';
export { updateLeadStatus } from './lead/updateLeadStatus.activity';

// lease
export { activateLease } from './lease/activateLease.activity';

// notification
export { sendEmail } from './notification/sendEmail.activity';

// payment
export { findPaymentMandate } from './payment/findPaymentMandate.activity';
export { savePaymentMandate } from './payment/savePaymentMandate.activity';
export { verifyBankAccount } from './payment/verifyBankAccount.activity';

// quote
export { createQuote } from './quote/createQuote.activity';
export { updateQuoteStatus } from './quote/updateQuoteStatus.activity';

// vehicle
export { releaseVehicle } from './vehicle/releaseVehicle.activity';
export { reserveVehicle } from './vehicle/reserveVehicle.activity';
