import { type BackupConfig } from "@shared/schema";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "fs";
import { join, basename } from "path";
import archiver from "archiver";
import { randomUUID } from "crypto";

const DATA_DIR = "data";
const TEMP_DIR = join(DATA_DIR, ".tmp");

export async function createBackupArchive(userId: string): Promise<string> {
  if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true });
  const archivePath = join(TEMP_DIR, `backup-${userId}-${Date.now()}.zip`);
  const userDir = join(DATA_DIR, "users", userId);

  return new Promise((resolve, reject) => {
    const output = createWriteStream(archivePath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolve(archivePath));
    archive.on("error", (err) => reject(err));

    archive.pipe(output);

    if (existsSync(userDir)) {
      archive.directory(userDir, `users/${userId}`);
    }

    archive.finalize();
  });
}

function getBackupFileName(userId: string): string {
  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `backup-${userId}-${dateStr}.zip`;
}

async function uploadToS3(config: NonNullable<BackupConfig["s3"]>, filePath: string, fileName: string): Promise<void> {
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  const fileStream = createReadStream(filePath);
  const key = `${config.prefix}${fileName}`;

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: fileStream,
    ContentType: "application/zip",
  }));
}

async function uploadToAzure(config: NonNullable<BackupConfig["azure"]>, filePath: string, fileName: string): Promise<void> {
  const { BlobServiceClient } = await import("@azure/storage-blob");
  const blobServiceClient = BlobServiceClient.fromConnectionString(config.connectionString);
  const containerClient = blobServiceClient.getContainerClient(config.containerName);
  await containerClient.createIfNotExists();

  const blobName = `${config.prefix}${fileName}`;
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.uploadFile(filePath);
}

async function uploadToGcp(config: NonNullable<BackupConfig["gcp"]>, filePath: string, fileName: string): Promise<void> {
  const { Storage } = await import("@google-cloud/storage");
  const credentials = JSON.parse(config.keyJson);
  const storage = new Storage({
    projectId: config.projectId,
    credentials,
  });

  const bucket = storage.bucket(config.bucket);
  const destination = `${config.prefix}${fileName}`;
  await bucket.upload(filePath, { destination });
}

export async function testConnection(config: BackupConfig): Promise<{ success: boolean; message: string }> {
  try {
    if (config.provider === "s3" && config.s3) {
      const { S3Client, HeadBucketCommand } = await import("@aws-sdk/client-s3");
      const client = new S3Client({
        region: config.s3.region,
        credentials: {
          accessKeyId: config.s3.accessKeyId,
          secretAccessKey: config.s3.secretAccessKey,
        },
      });
      await client.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
      return { success: true, message: `Connected to S3 bucket "${config.s3.bucket}" in ${config.s3.region}` };
    }

    if (config.provider === "azure" && config.azure) {
      const { BlobServiceClient } = await import("@azure/storage-blob");
      const blobServiceClient = BlobServiceClient.fromConnectionString(config.azure.connectionString);
      const containerClient = blobServiceClient.getContainerClient(config.azure.containerName);
      await containerClient.createIfNotExists();
      return { success: true, message: `Connected to Azure container "${config.azure.containerName}"` };
    }

    if (config.provider === "gcp" && config.gcp) {
      const { Storage } = await import("@google-cloud/storage");
      const credentials = JSON.parse(config.gcp.keyJson);
      const storage = new Storage({
        projectId: config.gcp.projectId,
        credentials,
      });
      const [exists] = await storage.bucket(config.gcp.bucket).exists();
      if (!exists) return { success: false, message: `GCP bucket "${config.gcp.bucket}" does not exist` };
      return { success: true, message: `Connected to GCP bucket "${config.gcp.bucket}"` };
    }

    return { success: false, message: "Missing provider configuration" };
  } catch (err: any) {
    return { success: false, message: err.message || "Connection failed" };
  }
}

export async function runBackup(userId: string, config: BackupConfig): Promise<{ success: boolean; message: string; fileName?: string }> {
  let archivePath: string | null = null;
  try {
    archivePath = await createBackupArchive(userId);
    const fileName = getBackupFileName(userId);
    const stats = statSync(archivePath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

    if (config.provider === "s3" && config.s3) {
      await uploadToS3(config.s3, archivePath, fileName);
    } else if (config.provider === "azure" && config.azure) {
      await uploadToAzure(config.azure, archivePath, fileName);
    } else if (config.provider === "gcp" && config.gcp) {
      await uploadToGcp(config.gcp, archivePath, fileName);
    } else {
      return { success: false, message: "Missing provider configuration" };
    }

    return { success: true, message: `Backup uploaded (${sizeMB} MB)`, fileName };
  } catch (err: any) {
    return { success: false, message: err.message || "Backup failed" };
  } finally {
    if (archivePath && existsSync(archivePath)) {
      try { unlinkSync(archivePath); } catch {}
    }
  }
}

export async function listBackups(config: BackupConfig, userId: string): Promise<{ name: string; size: number; lastModified: string }[]> {
  try {
    if (config.provider === "s3" && config.s3) {
      const { S3Client, ListObjectsV2Command } = await import("@aws-sdk/client-s3");
      const client = new S3Client({
        region: config.s3.region,
        credentials: {
          accessKeyId: config.s3.accessKeyId,
          secretAccessKey: config.s3.secretAccessKey,
        },
      });
      const result = await client.send(new ListObjectsV2Command({
        Bucket: config.s3.bucket,
        Prefix: `${config.s3.prefix}backup-${userId}`,
      }));
      return (result.Contents || [])
        .filter(obj => obj.Key?.endsWith(".zip"))
        .map(obj => ({
          name: basename(obj.Key || ""),
          size: obj.Size || 0,
          lastModified: obj.LastModified?.toISOString() || "",
        }))
        .sort((a, b) => b.lastModified.localeCompare(a.lastModified));
    }

    if (config.provider === "azure" && config.azure) {
      const { BlobServiceClient } = await import("@azure/storage-blob");
      const blobServiceClient = BlobServiceClient.fromConnectionString(config.azure.connectionString);
      const containerClient = blobServiceClient.getContainerClient(config.azure.containerName);
      const backups: { name: string; size: number; lastModified: string }[] = [];
      for await (const blob of containerClient.listBlobsFlat({ prefix: `${config.azure.prefix}backup-${userId}` })) {
        if (blob.name.endsWith(".zip")) {
          backups.push({
            name: basename(blob.name),
            size: blob.properties.contentLength || 0,
            lastModified: blob.properties.lastModified?.toISOString() || "",
          });
        }
      }
      return backups.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
    }

    if (config.provider === "gcp" && config.gcp) {
      const { Storage } = await import("@google-cloud/storage");
      const credentials = JSON.parse(config.gcp.keyJson);
      const storage = new Storage({ projectId: config.gcp.projectId, credentials });
      const [files] = await storage.bucket(config.gcp.bucket).getFiles({
        prefix: `${config.gcp.prefix}backup-${userId}`,
      });
      return files
        .filter(f => f.name.endsWith(".zip"))
        .map(f => ({
          name: basename(f.name),
          size: Number(f.metadata.size) || 0,
          lastModified: f.metadata.updated || "",
        }))
        .sort((a, b) => b.lastModified.localeCompare(a.lastModified));
    }

    return [];
  } catch {
    return [];
  }
}

export async function downloadBackup(config: BackupConfig, fileName: string): Promise<string | null> {
  if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true });
  const localPath = join(TEMP_DIR, `restore-${Date.now()}.zip`);

  try {
    if (config.provider === "s3" && config.s3) {
      const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
      const client = new S3Client({
        region: config.s3.region,
        credentials: {
          accessKeyId: config.s3.accessKeyId,
          secretAccessKey: config.s3.secretAccessKey,
        },
      });
      const key = `${config.s3.prefix}${fileName}`;
      const result = await client.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
      const stream = result.Body as NodeJS.ReadableStream;
      const ws = createWriteStream(localPath);
      await new Promise<void>((resolve, reject) => {
        stream.pipe(ws);
        ws.on("finish", resolve);
        ws.on("error", reject);
      });
      return localPath;
    }

    if (config.provider === "azure" && config.azure) {
      const { BlobServiceClient } = await import("@azure/storage-blob");
      const blobServiceClient = BlobServiceClient.fromConnectionString(config.azure.connectionString);
      const containerClient = blobServiceClient.getContainerClient(config.azure.containerName);
      const blobName = `${config.azure.prefix}${fileName}`;
      const blobClient = containerClient.getBlockBlobClient(blobName);
      await blobClient.downloadToFile(localPath);
      return localPath;
    }

    if (config.provider === "gcp" && config.gcp) {
      const { Storage } = await import("@google-cloud/storage");
      const credentials = JSON.parse(config.gcp.keyJson);
      const storage = new Storage({ projectId: config.gcp.projectId, credentials });
      const fileSrc = `${config.gcp.prefix}${fileName}`;
      await storage.bucket(config.gcp.bucket).file(fileSrc).download({ destination: localPath });
      return localPath;
    }

    return null;
  } catch {
    if (existsSync(localPath)) unlinkSync(localPath);
    return null;
  }
}

export async function restoreBackup(userId: string, zipPath: string): Promise<{ success: boolean; message: string }> {
  try {
    const { execSync } = await import("child_process");
    const userDir = join(DATA_DIR, "users", userId);

    const backupDir = join(TEMP_DIR, `restore-${randomUUID()}`);
    mkdirSync(backupDir, { recursive: true });

    execSync(`unzip -o "${zipPath}" -d "${backupDir}"`, { stdio: "pipe" });

    const extractedUserDir = join(backupDir, "users", userId);
    if (!existsSync(extractedUserDir)) {
      try { execSync(`rm -rf "${backupDir}"`, { stdio: "pipe" }); } catch {}
      return { success: false, message: "Backup does not contain data for this user" };
    }

    execSync(`rm -rf "${userDir}"`, { stdio: "pipe" });
    mkdirSync(userDir, { recursive: true });
    execSync(`cp -r "${extractedUserDir}/"* "${userDir}/"`, { stdio: "pipe" });

    try { execSync(`rm -rf "${backupDir}"`, { stdio: "pipe" }); } catch {}
    try { unlinkSync(zipPath); } catch {}

    return { success: true, message: "Backup restored. Please log out and log back in to see restored data." };
  } catch (err: any) {
    return { success: false, message: err.message || "Restore failed" };
  }
}

const backupTimers: Map<string, ReturnType<typeof setInterval>> = new Map();

export function startScheduledBackup(
  userId: string,
  config: BackupConfig,
  onLog: (level: string, message: string) => void
) {
  stopScheduledBackup(userId);

  if (!config.enabled || config.schedule === "manual") return;

  const intervalMs = {
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000,
    monthly: 30 * 24 * 60 * 60 * 1000,
  }[config.schedule];

  if (!intervalMs) return;

  onLog("info", `Scheduled ${config.schedule} backup to ${config.provider.toUpperCase()} started`);

  const timer = setInterval(async () => {
    onLog("info", `Running scheduled ${config.schedule} backup to ${config.provider.toUpperCase()}...`);
    const result = await runBackup(userId, config);
    if (result.success) {
      onLog("success", `Scheduled backup completed: ${result.message}`);
    } else {
      onLog("error", `Scheduled backup failed: ${result.message}`);
    }
  }, intervalMs);

  backupTimers.set(userId, timer);
}

export function stopScheduledBackup(userId: string) {
  const existing = backupTimers.get(userId);
  if (existing) {
    clearInterval(existing);
    backupTimers.delete(userId);
  }
}
