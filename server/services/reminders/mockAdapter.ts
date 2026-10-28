// ============================================================================
// Stage 5A Reminder Engine: Local Mock Delivery Adapter
// Processes reminder jobs locally without real message transmission
// ============================================================================

import { IDeliveryAdapter, DeliveryResult, ReminderJob } from './types';

export type MockAdapterMode = 'success' | 'retryable_failure' | 'permanent_failure' | 'ambiguous_timeout';

export class MockDeliveryAdapter implements IDeliveryAdapter {
  public readonly name = 'local_mock_adapter';
  private mode: MockAdapterMode = 'success';
  public callCount = 0;
  public lastCallParams?: any;

  constructor(initialMode: MockAdapterMode = 'success') {
    this.mode = initialMode;
  }

  setMode(mode: MockAdapterMode): void {
    this.mode = mode;
  }

  async deliver(params: {
    job: ReminderJob;
    member: { id: string; full_name: string; phone: string };
    subscription: { id: string; end_date: string; plan_name?: string };
    gym: { id: string; gym_name: string; phone_number: string };
  }): Promise<DeliveryResult> {
    this.callCount++;
    this.lastCallParams = params;

    if (this.mode === 'success') {
      const simulatedReceipt = `mock_msg_${params.job.milestone.toLowerCase()}_${Date.now()}`;
      return {
        outcome: 'delivered',
        provider: 'local_mock_adapter',
        provider_message_id: simulatedReceipt,
        is_mock: true
      };
    }

    if (this.mode === 'retryable_failure') {
      return {
        outcome: 'retryable_failure',
        provider: 'local_mock_adapter',
        error_code: 'SIMULATED_TRANSIENT_GATEWAY_BUSY',
        error_message: 'Simulated temporary carrier rate limit or gateway connection timeout',
        is_mock: true
      };
    }

    if (this.mode === 'permanent_failure') {
      return {
        outcome: 'permanent_failure',
        provider: 'local_mock_adapter',
        error_code: 'SIMULATED_INVALID_PHONE_DESTINATION',
        error_message: 'Simulated carrier unallocated or invalid mobile destination',
        is_mock: true
      };
    }

    if (this.mode === 'ambiguous_timeout') {
      return {
        outcome: 'ambiguous_timeout',
        provider: 'local_mock_adapter',
        error_code: 'SOCKET_DISCONNECT_UNVERIFIED',
        error_message: 'Connection dropped during upstream request; transmission status unverified',
        is_mock: true
      };
    }

    throw new Error(`Unsupported mock adapter mode: ${this.mode}`);
  }
}
