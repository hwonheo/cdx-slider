import { z } from 'zod';

export const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const text = z.string().trim().min(1).max(20000);
const lines = z.array(text).max(100).default([]);
const language = z.enum(['en', 'ko']).default('en');
export const context = { project: id, profile: id };
export const checkpointBody = z.object({
  goal: text,
  summary: text,
  decisions: lines,
  nextSteps: lines,
  checks: lines,
  files: lines,
}).strict();
export const schemas = {
  profile_register: z.object({
    id, label: z.string().trim().min(1).max(200),
    kind: z.enum(['desktop', 'cli']).default('desktop'),
    codexHome: z.string().min(1).max(4096).optional(),
  }).strict(),
  profiles_list: z.object({}).strict(),
  project_register: z.object({
    ...context, name: z.string().trim().min(1).max(200),
    path: z.string().min(1).max(4096),
  }).strict(),
  projects_list: z.object({ profile: id }).strict(),
  project_grant: z.object({ ...context, targetProfile: id }).strict(),
  memory_put: z.object({ ...context, key: id, content: text }).strict(),
  checkpoint_save: z.object({ ...context, ...checkpointBody.shape }).strict(),
  project_resume: z.object(context).strict(),
  handoff_export: z.object({ ...context, language }).strict(),
  relay_poll: z.object({ ...context, language, token: z.string().uuid() }).strict(),
  relay_ack: z.object({ language, token: z.string().uuid(), requestId: z.string().uuid(), status: z.enum(['accepted','rejected','unknown']) }).strict(),
  companion_open: z.object({ language }).strict(),
  restart_status: z.object({}).strict(),
  restart_schedule: z.object({ language, workSaved: z.literal(true) }).strict(),
  restart_cancel: z.object({ language }).strict(),
  login_start: z.object({ language, autoRestart: z.boolean().default(false), workSaved: z.boolean().default(false) }).strict(),
  login_status: z.object({}).strict(),
  login_cancel: z.object({ language, sessionId: z.string().uuid() }).strict(),
  workspace_read: z.object({}).strict(),
  account_read: z.object({}).strict(),
  usage_read: z.object({ profile: id }).strict(),
  slider_panel: z.object({ threadId: z.string().uuid().optional(), profile: id.optional(), project: id.optional(), currentPath: z.string().min(1).max(4096).optional() }).strict(),
  slider_home: z.object({ profile: id.optional(), project: id.optional() }).strict(),
};
