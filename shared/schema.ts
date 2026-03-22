import { z } from "zod";

export const labelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
});

export type EmailLabel = z.infer<typeof labelSchema>;

export const insertLabelSchema = labelSchema.omit({ id: true });
export type InsertLabel = z.infer<typeof insertLabelSchema>;

export const attachmentSchema = z.object({
  id: z.string(),
  filename: z.string(),
  contentType: z.string(),
  size: z.number(),
  cid: z.string().optional(),
});

export type EmailAttachment = z.infer<typeof attachmentSchema>;

export const emailSchema = z.object({
  id: z.string(),
  sender: z.object({
    name: z.string(),
    email: z.string(),
  }),
  to: z.array(z.object({
    name: z.string(),
    email: z.string(),
  })),
  cc: z.array(z.object({
    name: z.string(),
    email: z.string(),
  })).optional(),
  bcc: z.array(z.object({
    name: z.string(),
    email: z.string(),
  })).optional(),
  subject: z.string(),
  snippet: z.string(),
  body: z.string(),
  bodyHtml: z.string().optional(),
  date: z.string(),
  isUnread: z.boolean(),
  isStarred: z.boolean(),
  folder: z.string(),
  labels: z.array(z.string()).optional(),
  attachments: z.array(attachmentSchema).optional(),
  accountEmail: z.string().optional(),
  trashedAt: z.string().optional(),
  messageId: z.string().optional(),
  sendStatus: z.enum(["sending", "sent", "failed"]).optional(),
  sendError: z.string().optional(),
});

export type Email = z.infer<typeof emailSchema>;

export const insertEmailSchema = emailSchema.omit({ id: true });
export type InsertEmail = z.infer<typeof insertEmailSchema>;

export const mailAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  protocol: z.enum(["pop3", "imap"]),
  host: z.string(),
  port: z.number(),
  username: z.string(),
  password: z.string(),
  tls: z.boolean(),
  deleteOnFetch: z.boolean().optional(),
  smtpHost: z.string().optional(),
  smtpPort: z.number().optional(),
  smtpTls: z.boolean().optional(),
  lastFetched: z.string().nullable(),
  autoFetchEnabled: z.boolean().optional(),
  autoFetchInterval: z.number().optional(),
});

export type MailAccount = z.infer<typeof mailAccountSchema>;

export const insertMailAccountSchema = mailAccountSchema.omit({ id: true, lastFetched: true });
export type InsertMailAccount = z.infer<typeof insertMailAccountSchema>;

export const pop3AccountSchema = mailAccountSchema;
export type Pop3Account = MailAccount;
export const insertPop3AccountSchema = insertMailAccountSchema;
export type InsertPop3Account = InsertMailAccount;

export const generalSettingsSchema = z.object({
  displayDensity: z.enum(["default", "comfortable", "compact"]).default("default"),
  conversationView: z.boolean().default(true),
  showLabels: z.boolean().default(true),
  autoRefresh: z.boolean().default(true),
  refreshInterval: z.number().default(30),
  notifyNewMail: z.boolean().default(true),
  sendCancellation: z.number().default(5),
  signature: z.string().default(""),
  trashRetentionDays: z.number().default(30),
  defaultSendAccountId: z.string().default(""),
  emailsPerPage: z.number().default(20),
  clockFormat: z.enum(["12h", "24h"]).default("12h"),
  darkMode: z.boolean().default(false),
});

export type GeneralSettings = z.infer<typeof generalSettingsSchema>;

export const customFolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().default("#5f6368"),
});
export type CustomFolder = z.infer<typeof customFolderSchema>;
export const insertCustomFolderSchema = customFolderSchema.omit({ id: true });
export type InsertCustomFolder = z.infer<typeof insertCustomFolderSchema>;

export const emailRuleConditionSchema = z.object({
  field: z.enum(["from", "subject", "to"]),
  match: z.enum(["contains", "equals", "startsWith", "endsWith"]),
  value: z.string(),
});
export type EmailRuleCondition = z.infer<typeof emailRuleConditionSchema>;

export const emailRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean().default(true),
  conditions: z.array(emailRuleConditionSchema).min(1),
  conditionLogic: z.enum(["all", "any"]).default("all"),
  action: z.enum(["move", "label", "star", "markRead"]),
  targetFolder: z.string().optional(),
  targetLabel: z.string().optional(),
});
export type EmailRule = z.infer<typeof emailRuleSchema>;
export const insertEmailRuleSchema = emailRuleSchema.omit({ id: true });
export type InsertEmailRule = z.infer<typeof insertEmailRuleSchema>;

export const composeAttachmentSchema = z.object({
  name: z.string(),
  size: z.number(),
  type: z.string(),
  dataUrl: z.string(),
});

export const composeEmailSchema = z.object({
  to: z.string(),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  subject: z.string(),
  body: z.string(),
  accountId: z.string().optional(),
  inReplyTo: z.string().optional(),
  references: z.string().optional(),
  replyToId: z.string().optional(),
  attachments: z.array(composeAttachmentSchema).optional(),
});
export type ComposeEmail = z.infer<typeof composeEmailSchema>;

export const backupConfigSchema = z.object({
  provider: z.enum(["s3", "azure", "gcp"]),
  enabled: z.boolean().default(false),
  schedule: z.enum(["manual", "daily", "weekly", "monthly"]).default("manual"),
  scheduleTime: z.string().default("02:00"),
  lastBackup: z.string().optional(),
  lastBackupStatus: z.enum(["success", "failed"]).optional(),
  lastBackupMessage: z.string().optional(),
  s3: z.object({
    bucket: z.string(),
    region: z.string().default("us-east-1"),
    accessKeyId: z.string(),
    secretAccessKey: z.string(),
    prefix: z.string().default("localmail-backups/"),
  }).optional(),
  azure: z.object({
    connectionString: z.string(),
    containerName: z.string(),
    prefix: z.string().default("localmail-backups/"),
  }).optional(),
  gcp: z.object({
    bucket: z.string(),
    projectId: z.string(),
    keyJson: z.string(),
    prefix: z.string().default("localmail-backups/"),
  }).optional(),
});
export type BackupConfig = z.infer<typeof backupConfigSchema>;
export const insertBackupConfigSchema = backupConfigSchema;
export type InsertBackupConfig = z.infer<typeof insertBackupConfigSchema>;

export const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  password: z.string(),
  displayName: z.string().optional(),
  isAdmin: z.boolean().optional(),
});
export type User = z.infer<typeof userSchema>;
export const insertUserSchema = userSchema.omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
