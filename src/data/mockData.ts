import { Member, MembershipPlan, NotificationJob, DashboardStats } from '../types';

const COMMON_MEMBERSHIP_PERKS = [
  'Access to gym floor and training equipment',
  'Cardio and strength training areas',
  'Fitness assessment',
  'Access during regular gym opening hours'
];

export const MOCK_PLANS: MembershipPlan[] = [
  {
    id: 'plan-1m',
    name: '1 Month Standard',
    duration_days: 30,
    price: 1000,
    description: 'Standard gym facilities are included with every membership.',
    perks: [...COMMON_MEMBERSHIP_PERKS],
    is_active: true
  },
  {
    id: 'plan-3m',
    name: '3 Months Quarterly',
    duration_days: 90,
    price: 2500,
    popular: true,
    description: 'Standard gym facilities are included with every membership.',
    perks: [...COMMON_MEMBERSHIP_PERKS],
    is_active: true
  },
  {
    id: 'plan-6m',
    name: '6 Months Half-Yearly',
    duration_days: 180,
    price: 4500,
    description: 'Standard gym facilities are included with every membership.',
    perks: [...COMMON_MEMBERSHIP_PERKS],
    is_active: true
  },
  {
    id: 'plan-12m',
    name: 'Annual Gold VIP',
    duration_days: 365,
    price: 9000,
    description: 'Standard gym facilities are included with every membership.',
    perks: [...COMMON_MEMBERSHIP_PERKS],
    is_active: true
  }
];

export const INITIAL_MEMBERS: Member[] = [
  {
    id: 'mem-001',
    member_code: 'FIT-1001',
    full_name: 'Rajesh Kumar',
    phone: '+919876543210',
    email: 'rajesh.kumar@example.com',
    gender: 'male',
    status: 'expiring',
    whatsapp_consent: true,
    whatsapp_consent_at: '2025-10-24T10:00:00Z',
    sms_consent: true,
    sms_consent_at: '2025-10-24T10:00:00Z',
    emergency_contact_name: 'Sunita Kumar',
    emergency_contact_phone: '+919876543219',
    notes: 'Prefers morning sessions. Focusing on deadlifts & core.',
    created_at: '2025-10-24T08:30:00Z',
    current_subscription: {
      id: 'sub-001',
      member_id: 'mem-001',
      plan_id: 'plan-12m',
      plan_name: 'Annual Gold VIP',
      start_date: '2025-10-24',
      end_date: '2026-10-23', // Expiring in 3 days from local reference date
      status: 'active',
      amount_paid: 9000,
      payment_method: 'upi',
      version: 1,
      idempotency_key: 'idemp-sub-001',
      created_at: '2025-10-24T08:30:00Z'
    }
  },
  {
    id: 'mem-002',
    member_code: 'FIT-1002',
    full_name: 'Priya Sharma',
    phone: '+919812345678',
    email: 'priya.s@example.com',
    gender: 'female',
    status: 'active',
    whatsapp_consent: true,
    whatsapp_consent_at: '2026-08-15T11:00:00Z',
    sms_consent: false,
    sms_consent_at: '2026-08-15T11:00:00Z',
    emergency_contact_name: 'Amit Sharma',
    emergency_contact_phone: '+919812345670',
    notes: 'Regular attendee of spin and HIIT classes.',
    created_at: '2026-08-15T09:15:00Z',
    current_subscription: {
      id: 'sub-002',
      member_id: 'mem-002',
      plan_id: 'plan-3m',
      plan_name: '3 Months Quarterly',
      start_date: '2026-08-15',
      end_date: '2026-11-13',
      status: 'active',
      amount_paid: 2500,
      payment_method: 'card',
      version: 1,
      idempotency_key: 'idemp-sub-002',
      created_at: '2026-08-15T09:15:00Z'
    }
  },
  {
    id: 'mem-003',
    member_code: 'FIT-1003',
    full_name: 'Vikram Singh',
    phone: '+919988776655',
    email: 'vikram.singh@example.com',
    gender: 'male',
    status: 'expiring',
    whatsapp_consent: true,
    whatsapp_consent_at: '2026-09-20T14:00:00Z',
    sms_consent: true,
    sms_consent_at: '2026-09-20T14:00:00Z',
    notes: 'Powerlifting training, needs belt storage.',
    created_at: '2026-09-20T14:00:00Z',
    current_subscription: {
      id: 'sub-003',
      member_id: 'mem-003',
      plan_id: 'plan-1m',
      plan_name: '1 Month Standard',
      start_date: '2026-09-20',
      end_date: '2026-10-20', // Expiring today (T-0)
      status: 'active',
      amount_paid: 1000,
      payment_method: 'cash',
      version: 1,
      idempotency_key: 'idemp-sub-003',
      created_at: '2026-09-20T14:00:00Z'
    }
  },
  {
    id: 'mem-004',
    member_code: 'FIT-1004',
    full_name: 'Ananya Deshmukh',
    phone: '+919765432109',
    email: 'ananya.d@example.com',
    gender: 'female',
    status: 'expired',
    whatsapp_consent: true,
    whatsapp_consent_at: '2026-07-10T12:00:00Z',
    sms_consent: true,
    sms_consent_at: '2026-07-10T12:00:00Z',
    notes: 'Expired 3 days ago. Grace period reminder dispatched.',
    created_at: '2026-07-10T12:00:00Z',
    current_subscription: {
      id: 'sub-004',
      member_id: 'mem-004',
      plan_id: 'plan-3m',
      plan_name: '3 Months Quarterly',
      start_date: '2026-07-10',
      end_date: '2026-10-17', // Expired 3 days ago (T+3)
      status: 'expired',
      amount_paid: 2500,
      payment_method: 'upi',
      version: 1,
      idempotency_key: 'idemp-sub-004',
      created_at: '2026-07-10T12:00:00Z'
    }
  },
  {
    id: 'mem-005',
    member_code: 'FIT-1005',
    full_name: 'Mohammed Rizwan',
    phone: '+919845012345',
    email: 'rizwan.m@example.com',
    gender: 'male',
    status: 'active',
    whatsapp_consent: true,
    whatsapp_consent_at: '2026-05-01T10:00:00Z',
    sms_consent: true,
    sms_consent_at: '2026-05-01T10:00:00Z',
    notes: 'Annual VIP member, attends evening strength conditioning.',
    created_at: '2026-05-01T10:00:00Z',
    current_subscription: {
      id: 'sub-005',
      member_id: 'mem-005',
      plan_id: 'plan-12m',
      plan_name: 'Annual Gold VIP',
      start_date: '2026-05-01',
      end_date: '2027-04-30',
      status: 'active',
      amount_paid: 9000,
      payment_method: 'bank_transfer',
      version: 1,
      idempotency_key: 'idemp-sub-005',
      created_at: '2026-05-01T10:00:00Z'
    }
  },
  {
    id: 'mem-006',
    member_code: 'FIT-1006',
    full_name: 'Deepika Iyer',
    phone: '+919900112233',
    email: 'deepika.iyer@example.com',
    gender: 'female',
    status: 'active',
    whatsapp_consent: false,
    whatsapp_consent_at: '2026-09-01T15:00:00Z',
    sms_consent: true,
    sms_consent_at: '2026-09-01T15:00:00Z',
    notes: 'Opted out of WhatsApp. SMS fallback preferred.',
    created_at: '2026-09-01T15:00:00Z',
    current_subscription: {
      id: 'sub-006',
      member_id: 'mem-006',
      plan_id: 'plan-6m',
      plan_name: '6 Months Half-Yearly',
      start_date: '2026-09-01',
      end_date: '2027-02-28',
      status: 'active',
      amount_paid: 4500,
      payment_method: 'card',
      version: 1,
      idempotency_key: 'idemp-sub-006',
      created_at: '2026-09-01T15:00:00Z'
    }
  }
];

export const INITIAL_REMINDER_JOBS: NotificationJob[] = [
  {
    id: 'job-101',
    member_id: 'mem-001',
    member_name: 'Rajesh Kumar',
    member_phone: '+919876543210',
    subscription_id: 'sub-001',
    milestone: 'EXPIRY_MINUS_3',
    target_date: '2026-10-20',
    channel: 'whatsapp',
    status: 'completed',
    scheduled_for: '2026-10-20T10:00:00+05:30',
    attempt_count: 1,
    max_attempts: 3,
    attempts: [
      {
        id: 'att-501',
        job_id: 'job-101',
        channel: 'whatsapp',
        provider: 'meta_whatsapp',
        provider_message_id: 'wamid.HBgLMDkxOTg3NjU0MzIxMBsC',
        status: 'delivered',
        sent_at: '2026-10-20T10:00:15+05:30',
        delivered_at: '2026-10-20T10:00:22+05:30'
      }
    ]
  },
  {
    id: 'job-102',
    member_id: 'mem-003',
    member_name: 'Vikram Singh',
    member_phone: '+919988776655',
    subscription_id: 'sub-003',
    milestone: 'EXPIRY_ZERO',
    target_date: '2026-10-20',
    channel: 'whatsapp',
    status: 'dispatching',
    scheduled_for: '2026-10-20T10:00:00+05:30',
    attempt_count: 1,
    max_attempts: 3,
    attempts: [
      {
        id: 'att-502',
        job_id: 'job-102',
        channel: 'whatsapp',
        provider: 'meta_whatsapp',
        status: 'dispatching',
        sent_at: '2026-10-20T10:02:00+05:30'
      }
    ]
  },
  {
    id: 'job-103',
    member_id: 'mem-004',
    member_name: 'Ananya Deshmukh',
    member_phone: '+919765432109',
    subscription_id: 'sub-004',
    milestone: 'EXPIRY_PLUS_3',
    target_date: '2026-10-20',
    channel: 'whatsapp',
    status: 'completed',
    scheduled_for: '2026-10-20T10:00:00+05:30',
    attempt_count: 2,
    max_attempts: 3,
    attempts: [
      {
        id: 'att-503-wa',
        job_id: 'job-103',
        channel: 'whatsapp',
        provider: 'meta_whatsapp',
        status: 'failed_permanent',
        sent_at: '2026-10-20T10:01:00+05:30',
        error_code: '131026',
        error_message: 'Recipient number is not registered on WhatsApp.'
      },
      {
        id: 'att-503-sms',
        job_id: 'job-103',
        channel: 'sms',
        provider: 'fast2sms',
        provider_message_id: 'sms_99882233',
        status: 'delivered',
        sent_at: '2026-10-20T10:01:05+05:30',
        delivered_at: '2026-10-20T10:01:12+05:30'
      }
    ]
  },
  {
    id: 'job-104',
    member_id: 'mem-006',
    member_name: 'Deepika Iyer',
    member_phone: '+919900112233',
    subscription_id: 'sub-006',
    milestone: 'MANUAL_TRIGGER',
    target_date: '2026-10-20',
    channel: 'sms',
    status: 'pending',
    scheduled_for: '2026-10-20T11:00:00+05:30',
    attempt_count: 0,
    max_attempts: 3
  }
];

export const INITIAL_STATS: DashboardStats = {
  totalMembers: 104,
  activeMembers: 91,
  expiringIn7Days: 7,
  expiredMembers: 6,
  todayReminders: {
    scheduled: 5,
    claimed: 1,
    completed: 3,
    reconciling: 1,
    failed: 0
  },
  integrations: {
    whatsappConnected: true,
    smsConnected: true,
    dltRegistered: true
  }
};
