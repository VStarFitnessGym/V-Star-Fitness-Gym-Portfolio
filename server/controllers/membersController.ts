// ============================================================================
// Members Controller (GET /api/members)
// Paginated, tenant-scoped member list with active subscription lookup
// ============================================================================

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest, MemberListItem, PaginatedResult } from '../types';
import { GetMembersQuerySchema } from '../validators/memberValidators';
import { db } from '../db/database';
import { sendProblem } from '../utils/problemDetails';

function toDateString(val: any): string {
  if (!val) return '';
  if (typeof val === 'string') return val.substring(0, 10);
  if (val instanceof Date) {
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const d = new Date(val);
  if (!isNaN(d.getTime())) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return String(val);
}

export async function getMembers(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      sendProblem(res, {
        status: 401,
        code: 'UNAUTHORIZED',
        title: 'Authentication Required',
        detail: 'Authentication is required to query members.',
        instance: req.originalUrl,
        requestId: req.requestId
      });
      return;
    }

    // 1. Validate query parameters with Zod
    const query = GetMembersQuerySchema.parse(req.query);
    const { page, limit, status, search, sort_by, sort_order } = query;
    const offset = (page - 1) * limit;
    const gymId = req.user.gym_id;

    // 2. Build parameterized query
    const whereClauses: string[] = ['m.gym_id = $1'];
    const queryParams: any[] = [gymId];
    let paramIndex = 2;

    if (status) {
      whereClauses.push(`m.status = $${paramIndex}`);
      queryParams.push(status);
      paramIndex++;
    }

    if (search) {
      whereClauses.push(
        `(m.full_name ILIKE $${paramIndex} OR m.member_code ILIKE $${paramIndex} OR m.phone ILIKE $${paramIndex})`
      );
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    const whereSql = whereClauses.join(' AND ');

    // 3. Count total matching rows
    const countSql = `SELECT COUNT(*) as total FROM public.members m WHERE ${whereSql};`;
    const countRes = await db.query(countSql, queryParams);
    const total = parseInt(countRes.rows[0]?.total || '0', 10);

    // 4. Safe sorting columns
    const allowedSortCols: Record<string, string> = {
      full_name: 'm.full_name',
      created_at: 'm.created_at',
      member_code: 'm.member_code'
    };
    const sortCol = allowedSortCols[sort_by] || 'm.created_at';
    const sortDir = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // 5. Query page rows with active subscription
    const dataSql = `
      SELECT 
        m.id,
        m.gym_id,
        m.member_code,
        m.full_name,
        m.phone,
        m.email,
        m.status,
        m.whatsapp_consent,
        m.sms_consent,
        m.created_at,
        s.id as sub_id,
        p.name as plan_name,
        s.start_date,
        s.end_date,
        s.status as sub_status
      FROM public.members m
      LEFT JOIN LATERAL (
        SELECT sub.id, sub.plan_id, sub.start_date, sub.end_date, sub.status
        FROM public.subscriptions sub
        WHERE sub.member_id = m.id AND sub.status = 'active'
        ORDER BY sub.end_date DESC
        LIMIT 1
      ) s ON true
      LEFT JOIN public.membership_plans p ON p.id = s.plan_id
      WHERE ${whereSql}
      ORDER BY ${sortCol} ${sortDir}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
    `;

    queryParams.push(limit, offset);
    const dataRes = await db.query(dataSql, queryParams);

    const members: MemberListItem[] = dataRes.rows.map((row: any) => ({
      id: row.id,
      gym_id: row.gym_id,
      member_code: row.member_code,
      full_name: row.full_name,
      phone: row.phone,
      email: row.email,
      status: row.status,
      whatsapp_consent: row.whatsapp_consent,
      sms_consent: row.sms_consent,
      created_at: row.created_at,
      current_subscription: row.sub_id
        ? {
            id: row.sub_id,
            plan_name: row.plan_name || 'Membership Plan',
            start_date: toDateString(row.start_date),
            end_date: toDateString(row.end_date),
            status: row.sub_status
          }
        : null
    }));

    const response: PaginatedResult<MemberListItem> = {
      data: members,
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit) || 1
      }
    };

    res.status(200).json(response);
  } catch (err) {
    next(err);
  }
}
