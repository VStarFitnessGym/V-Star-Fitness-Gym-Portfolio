// ============================================================================
// RFC 7807 Problem Details Response Formatter
// ============================================================================

import { Response } from 'express';
import { ProblemDetails } from '../types';

export function createProblemDetails(params: {
  status: number;
  code: string;
  title: string;
  detail: string;
  instance?: string;
  invalidParams?: Array<{ field: string; message: string }>;
  requestId?: string;
}): ProblemDetails {
  return {
    type: `https://fitfusion.local/errors/${params.code.toLowerCase()}`,
    title: params.title,
    status: params.status,
    detail: params.detail,
    instance: params.instance,
    code: params.code,
    invalid_params: params.invalidParams,
    request_id: params.requestId,
    timestamp: new Date().toISOString()
  };
}

export function sendProblem(
  res: Response,
  params: {
    status: number;
    code: string;
    title: string;
    detail: string;
    instance?: string;
    invalidParams?: Array<{ field: string; message: string }>;
    requestId?: string;
  }
): Response {
  const problem = createProblemDetails(params);
  return res
    .status(params.status)
    .setHeader('Content-Type', 'application/problem+json')
    .json(problem);
}
