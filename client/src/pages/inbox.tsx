import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import DOMPurify from "dompurify";
import {
  Inbox as InboxIcon,
  Send,
  FileText,
  Trash2,
  Archive,
  Search,
  Star,
  Clock,
  Reply,
  ReplyAll,
  Forward,
  Printer,
  ArrowLeft,
  MoreVertical,
  Plus,
  X,
  Settings,
  RefreshCw,
  Mail,
  Pencil,
  Tag,
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  ExternalLink,
  CheckCircle,
  Loader2,
  XCircle,
  Paperclip,
  Download,
  Image,
  FileIcon,
  FileSpreadsheet,
  FileArchive,
  Eye,
  Code,
  LogOut,
  UserPlus,
  AtSign,
  Maximize2,
  Minimize2,
  Bold,
  Italic,
  Underline,
  Type,
  List,
  ListOrdered,
  Link as LinkIcon,
  SquareCheck,
  Minus,
  FolderInput,
  MailOpen,
  Filter,
  Menu,
  FolderPlus,
  Folder,
  Moon,
  Sun,
  Shield,
  ZoomIn,
  FileImage,
  HardDrive,
  CloudUpload,
  RotateCcw,
  Play,
  ChevronUp,
  ShieldCheck,
  Ban,
  Bell,
  BellOff,
  Palmtree,
  Info,
  PlusCircle,
  ListChecks,
  Sparkles,
} from "lucide-react";
import { format, isToday, isThisYear } from "date-fns";
import type { Email, Pop3Account, EmailLabel, GeneralSettings, EmailAttachment, MailAccount, CustomFolder, EmailRule, EmailRuleCondition, BackupConfig } from "@shared/schema";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import brandIcon from "@/assets/localmail.png";

const FOLDERS = [
  { id: "inbox", label: "Inbox", icon: InboxIcon },
  { id: "starred", label: "Starred", icon: Star },
  { id: "snoozed", label: "Snoozed", icon: Clock },
  { id: "sent", label: "Sent", icon: Send },
  { id: "trash", label: "Trash", icon: Trash2 },
  { id: "drafts", label: "Drafts", icon: FileText },
  { id: "all", label: "All Mail", icon: Mail },
  { id: "archive", label: "Archive", icon: Archive },
  { id: "spam", label: "Spam", icon: AlertCircle },
];

function normalizeSubject(subject: string): string {
  return (subject || "").replace(/^(Re|Fwd?|RE|FW?)(\[\d+\])?:\s*/gi, "").trim().toLowerCase();
}

function formatEmailDate(dateStr: string, clockFormat: "12h" | "24h" = "12h") {
  const d = new Date(dateStr);
  if (isToday(d)) return format(d, clockFormat === "24h" ? "HH:mm" : "h:mm a");
  if (isThisYear(d)) return format(d, "MMM d");
  return format(d, "MM/dd/yy");
}

interface InboxProps {
  user: { id: string; username: string; displayName?: string };
  onLogout: () => void;
}

export default function InboxPage({ user, onLogout }: InboxProps) {
  const [activeFolder, setActiveFolder] = useState("inbox");
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [activeAccount, setActiveAccount] = useState<string | null>(null);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [selectedThreadEmails, setSelectedThreadEmails] = useState<Email[] | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeDefaults, setComposeDefaults] = useState<{to?: string; cc?: string; subject?: string; body?: string; inReplyTo?: string; references?: string; accountEmail?: string} | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [labelsExpanded, setLabelsExpanded] = useState(true);
  const [accountsExpanded, setAccountsExpanded] = useState(true);
  const [moreExpanded, setMoreExpanded] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedEmailIds, setSelectedEmailIds] = useState<Set<string>>(new Set());
  const [selectMenuOpen, setSelectMenuOpen] = useState(false);
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [filterScope, setFilterScope] = useState<"current" | "all">("current");
  const [filterHasAttachment, setFilterHasAttachment] = useState(false);
  const [filterUnread, setFilterUnread] = useState(false);
  const [filterStarred, setFilterStarred] = useState(false);
  const [filterDateRange, setFilterDateRange] = useState("");
  const [filterSearchBody, setFilterSearchBody] = useState(false);
  const [filterFrom, setFilterFrom] = useState("");

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const settingsQuery = useQuery<GeneralSettings>({
    queryKey: ["/api/settings"],
  });
  const settings = settingsQuery.data;

  const activeFiltersCount = [filterHasAttachment, filterUnread, filterStarred, !!filterDateRange, filterSearchBody, filterScope === "all", !!filterFrom].filter(Boolean).length;
  const isFiltering = !!(searchQuery || filterHasAttachment || filterUnread || filterStarred || filterDateRange || filterSearchBody || filterFrom);

  const queryKey = (() => {
    const p = new URLSearchParams();
    // Always pass current context
    if (activeLabel) p.set("label", activeLabel);
    else if (activeAccount) p.set("account", activeAccount);
    else p.set("folder", activeFolder);

    if (isFiltering) {
      const combinedSearch = [filterFrom ? `from:${filterFrom}` : "", searchQuery].filter(Boolean).join(" ");
      if (combinedSearch) p.set("search", combinedSearch);
      if (filterScope === "all") p.set("scope", "all");
      if (filterHasAttachment) p.set("hasAttachment", "1");
      if (filterUnread) p.set("unread", "1");
      if (filterStarred) p.set("starred", "1");
      if (filterDateRange) p.set("dateRange", filterDateRange);
      if (filterSearchBody) p.set("searchBody", "1");
    }
    return `/api/emails?${p.toString()}`;
  })();

  const emailsQuery = useQuery<Email[]>({
    queryKey: [queryKey],
    refetchInterval: 30_000,
  });

  const labelsQuery = useQuery<EmailLabel[]>({
    queryKey: ["/api/labels"],
  });

  const accountsQuery = useQuery<MailAccount[]>({
    queryKey: ["/api/accounts"],
  });

  const customFoldersQuery = useQuery<CustomFolder[]>({
    queryKey: ["/api/custom-folders"],
  });

  useEffect(() => {
    if (settings?.darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [settings?.darkMode]);

  // Track inbox unread count for document title
  const allEmails = emailsQuery.data || [];
  const inboxUnreadCount = allEmails.filter(e => e.isUnread && e.folder === "inbox").length;
  useEffect(() => {
    document.title = inboxUnreadCount > 0 ? `LocalMail (${inboxUnreadCount})` : "LocalMail";
    return () => { document.title = "LocalMail"; };
  }, [inboxUnreadCount]);

  // Browser notification detection — fire when new emails arrive during auto-refresh
  const prevEmailIdsRef = useRef<Set<string>>(new Set());
  const notificationsInitializedRef = useRef(false);
  useEffect(() => {
    const emails = emailsQuery.data;
    if (!emails) return;
    const currentIds = new Set(emails.map(e => e.id));
    if (!notificationsInitializedRef.current) {
      prevEmailIdsRef.current = currentIds;
      notificationsInitializedRef.current = true;
      return;
    }
    if (settings?.notifyNewMail && "Notification" in window && Notification.permission === "granted") {
      const newInboxEmails = emails.filter(
        e => !prevEmailIdsRef.current.has(e.id) && e.folder === "inbox" && e.isUnread
      );
      if (newInboxEmails.length === 1) {
        const e = newInboxEmails[0];
        const n = new Notification(`New email from ${e.sender.name || e.sender.email}`, {
          body: e.subject,
          icon: "/favicon.ico",
          tag: "localmail-new",
        });
        n.onclick = () => { window.focus(); };
      } else if (newInboxEmails.length > 1) {
        const n = new Notification(`${newInboxEmails.length} new messages`, {
          body: newInboxEmails.map(e => e.subject).join(", "),
          icon: "/favicon.ico",
          tag: "localmail-new",
        });
        n.onclick = () => { window.focus(); };
      }
    }
    prevEmailIdsRef.current = currentIds;
  }, [emailsQuery.data]);

  const labels = labelsQuery.data || [];
  const accounts = accountsQuery.data || [];
  const customFolders = customFoldersQuery.data || [];

  const perPage = settings?.emailsPerPage || 20;
  const totalPages = Math.max(1, Math.ceil(allEmails.length / perPage));
  const safePage = Math.min(currentPage, totalPages);
  const emails = allEmails.slice((safePage - 1) * perPage, safePage * perPage);
  const selectedEmail = selectedEmailId ? allEmails.find(e => e.id === selectedEmailId) : null;

  const unreadCountsQuery = useQuery<Record<string, number>>({
    queryKey: ["/api/emails/unread-counts"],
    refetchInterval: 30000,
  });
  const unreadCounts = unreadCountsQuery.data || {};
  const inboxUnread = unreadCounts["inbox"] || 0;

  useEffect(() => {
    const totalUnread = inboxUnread;
    document.title = totalUnread > 0 ? `Inbox (${totalUnread}) - LocalMail` : "LocalMail";
  }, [inboxUnread]);

  const starMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/emails/${id}/star`);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (err: Error) => toast({ title: "Failed to update star", description: err.message, variant: "destructive" }),
  });

  const readMutation = useMutation({
    mutationFn: async ({ id, isUnread }: { id: string; isUnread: boolean }) => {
      const res = await apiRequest("PATCH", `/api/emails/${id}/read`, { isUnread });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (err: Error) => toast({ title: "Failed to update", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/emails/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      setSelectedEmailId(null);
      toast({ title: "Conversation moved to Trash." });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/emails/${id}/move`, { folder: "archive" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      setSelectedEmailId(null);
      toast({ title: "Conversation archived." });
    },
  });

  const addLabelMutation = useMutation({
    mutationFn: async ({ emailId, labelId }: { emailId: string; labelId: string }) => {
      const res = await apiRequest("POST", `/api/emails/${emailId}/labels/${labelId}`);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (err: Error) => toast({ title: "Failed to add label", description: err.message, variant: "destructive" }),
  });

  const removeLabelMutation = useMutation({
    mutationFn: async ({ emailId, labelId }: { emailId: string; labelId: string }) => {
      const res = await apiRequest("DELETE", `/api/emails/${emailId}/labels/${labelId}`);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (err: Error) => toast({ title: "Failed to remove label", description: err.message, variant: "destructive" }),
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/logout");
      return res.json();
    },
    onSuccess: () => onLogout(),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      setSelectedEmailIds(new Set());
      const res = await apiRequest("POST", "/api/emails/batch/delete", { ids });
      return res.json();
    },
    onSuccess: (data: { trashed: number; deleted: number }) => {
      queryClient.invalidateQueries();
      if (data.deleted > 0) {
        toast({ title: `${data.deleted} conversation(s) permanently deleted.` });
      } else {
        toast({ title: `${data.trashed} conversation(s) moved to Trash.` });
      }
    },
  });

  const bulkArchiveMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      setSelectedEmailIds(new Set());
      const res = await apiRequest("POST", "/api/emails/batch/move", { ids, folder: "archive" });
      return res.json();
    },
    onSuccess: (data: { moved: number }) => {
      queryClient.invalidateQueries();
      toast({ title: `${data.moved} conversation(s) archived.` });
    },
  });

  const bulkReadMutation = useMutation({
    mutationFn: async ({ ids, isUnread }: { ids: string[]; isUnread: boolean }) => {
      setSelectedEmailIds(new Set());
      await apiRequest("POST", "/api/emails/batch/read", { ids, isUnread });
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });

  const bulkStarMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      setSelectedEmailIds(new Set());
      await apiRequest("POST", "/api/emails/batch/star", { ids });
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });

  const bulkMoveMutation = useMutation({
    mutationFn: async ({ ids, folder }: { ids: string[]; folder: string }) => {
      const count = ids.length;
      setSelectedEmailIds(new Set());
      await apiRequest("POST", "/api/emails/batch/move", { ids, folder });
      return { count, folder };
    },
    onSuccess: (data: { count: number; folder: string }) => {
      queryClient.invalidateQueries();
      setMoveMenuOpen(false);
      const folderName = FOLDERS.find(f => f.id === data.folder)?.label
        || customFolders.find(cf => `custom:${cf.id}` === data.folder)?.name
        || data.folder;
      toast({ title: `Moved ${data.count} conversation(s) to ${folderName}.` });
    },
  });

  const bulkPermanentDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      setSelectedEmailIds(new Set());
      const res = await apiRequest("POST", "/api/emails/batch/delete", { ids });
      return res.json();
    },
    onSuccess: (data: { trashed: number; deleted: number }) => {
      queryClient.invalidateQueries();
      toast({ title: `${data.deleted} conversation(s) permanently deleted.` });
    },
  });

  const markAsSpamMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/emails/${id}/move`, { folder: "spam" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      setSelectedEmailId(null);
      toast({ title: "Moved to Spam." });
    },
  });

  const notSpamMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/emails/${id}/move`, { folder: "inbox" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      setSelectedEmailId(null);
      toast({ title: "Moved to Inbox." });
    },
  });

  const blockSenderMutation = useMutation({
    mutationFn: async ({ emailId, senderEmail, senderName }: { emailId: string; senderEmail: string; senderName: string }) => {
      await apiRequest("POST", "/api/rules", {
        name: `Block ${senderName || senderEmail}`,
        enabled: true,
        conditions: [{ field: "from", match: "contains", value: senderEmail }],
        conditionLogic: "all",
        action: "move",
        targetFolder: "spam",
      });
      await apiRequest("PATCH", `/api/emails/${emailId}/move`, { folder: "spam" });
    },
    onSuccess: (_data, { senderEmail }) => {
      queryClient.invalidateQueries();
      setSelectedEmailId(null);
      toast({ title: `Sender blocked. Future emails from ${senderEmail} will go to Spam.` });
    },
  });

  const bulkMarkAsSpamMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const count = ids.length;
      setSelectedEmailIds(new Set());
      await apiRequest("POST", "/api/emails/batch/move", { ids, folder: "spam" });
      return count;
    },
    onSuccess: (count: number) => {
      queryClient.invalidateQueries();
      toast({ title: `${count} conversation(s) moved to Spam.` });
    },
  });

  const bulkNotSpamMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const count = ids.length;
      setSelectedEmailIds(new Set());
      await apiRequest("POST", "/api/emails/batch/move", { ids, folder: "inbox" });
      return count;
    },
    onSuccess: (count: number) => {
      queryClient.invalidateQueries();
      toast({ title: `${count} conversation(s) moved to Inbox.` });
    },
  });

  const unsubscribeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/emails/${id}/unsubscribe`);
      return res.json() as Promise<{ type: "success" | "url" | "mailto"; url?: string; to?: string; subject?: string }>;
    },
    onSuccess: (data) => {
      if (data.type === "success") {
        toast({ title: "Unsubscribed successfully." });
      } else if (data.type === "url") {
        window.open(data.url, "_blank", "noopener,noreferrer");
        toast({ title: "Unsubscribe page opened in a new tab." });
      } else if (data.type === "mailto") {
        setComposeDefaults({ to: data.to, subject: data.subject });
        setComposeOpen(true);
        toast({ title: "Compose your unsubscribe email and send it." });
      }
    },
    onError: () => {
      toast({ title: "Unsubscribe failed", description: "Could not process the unsubscribe request.", variant: "destructive" });
    },
  });

  const isBulkBusy = bulkDeleteMutation.isPending || bulkArchiveMutation.isPending || bulkReadMutation.isPending || bulkStarMutation.isPending || bulkMoveMutation.isPending || bulkPermanentDeleteMutation.isPending || bulkMarkAsSpamMutation.isPending || bulkNotSpamMutation.isPending;

  const toggleEmailSelection = (id: string) => {
    setSelectedEmailIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllEmails = () => { setSelectedEmailIds(new Set(emails.map(e => e.id))); setSelectMenuOpen(false); };
  const selectNoneEmails = () => { setSelectedEmailIds(new Set()); setSelectMenuOpen(false); };
  const selectReadEmails = () => { setSelectedEmailIds(new Set(emails.filter(e => !e.isUnread).map(e => e.id))); setSelectMenuOpen(false); };
  const selectUnreadEmails = () => { setSelectedEmailIds(new Set(emails.filter(e => e.isUnread).map(e => e.id))); setSelectMenuOpen(false); };
  const selectStarredEmails = () => { setSelectedEmailIds(new Set(emails.filter(e => e.isStarred).map(e => e.id))); setSelectMenuOpen(false); };
  const selectUnstarredEmails = () => { setSelectedEmailIds(new Set(emails.filter(e => !e.isStarred).map(e => e.id))); setSelectMenuOpen(false); };

  const handleSelectEmail = (email: Email) => {
    setSelectedEmailId(email.id);
    if (email.isUnread) {
      readMutation.mutate({ id: email.id, isUnread: false });
    }
  };

  const handleBack = () => {
    setSelectedEmailId(null);
    setSelectedThreadEmails(null);
  };

  const handleSelectThread = (threadEmails: Email[]) => {
    setSelectedThreadEmails(threadEmails);
    setSelectedEmailId(null);
    threadEmails.filter(e => e.isUnread).forEach(e => {
      readMutation.mutate({ id: e.id, isUnread: false });
    });
  };

  const sanitizeForCompose = (html: string) => {
    return DOMPurify.sanitize(html, {
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'button'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
      ALLOW_DATA_ATTR: false,
    });
  };

  const buildQuotedBody = (email: Email, fullBody: string) => {
    const dateStr = format(new Date(email.date), "EEE, MMM d, yyyy 'at' h:mm a");
    const senderStr = `${email.sender.name} &lt;${email.sender.email}&gt;`;
    const sanitized = sanitizeForCompose(fullBody);
    return `<br><br><div class="gmail_quote"><div style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex"><p>On ${dateStr}, ${senderStr} wrote:</p>${sanitized}</div></div>`;
  };

  const handleReply = async () => {
    if (!selectedEmail) return;
    try {
      const res = await fetch(`/api/emails/${selectedEmail.id}`, { credentials: "include" });
      const full = await res.json();
      const quotedBody = buildQuotedBody(selectedEmail, full.bodyHtml || full.body);
      const reSubject = selectedEmail.subject.startsWith("Re:") ? selectedEmail.subject : `Re: ${selectedEmail.subject}`;
      setComposeDefaults({
        to: selectedEmail.sender.email,
        subject: reSubject,
        body: (settings?.signature ? `<br><br>${settings.signature}` : "") + quotedBody,
        inReplyTo: selectedEmail.messageId,
        references: selectedEmail.messageId,
        accountEmail: selectedEmail.accountEmail,
      });
      setComposeOpen(true);
    } catch {}
  };

  const handleReplyAll = async () => {
    if (!selectedEmail) return;
    try {
      const res = await fetch(`/api/emails/${selectedEmail.id}`, { credentials: "include" });
      const full = await res.json();
      const quotedBody = buildQuotedBody(selectedEmail, full.bodyHtml || full.body);
      const reSubject = selectedEmail.subject.startsWith("Re:") ? selectedEmail.subject : `Re: ${selectedEmail.subject}`;
      const myAccounts = (accountsQuery.data || []).map(a => a.email.toLowerCase());
      const allTo = [selectedEmail.sender, ...(selectedEmail.to || []), ...(selectedEmail.cc || [])]
        .filter(r => !myAccounts.includes(r.email.toLowerCase()))
        .filter((r, i, arr) => arr.findIndex(x => x.email.toLowerCase() === r.email.toLowerCase()) === i);
      const toStr = allTo.map(r => r.email).join(", ");
      setComposeDefaults({
        to: toStr,
        subject: reSubject,
        body: (settings?.signature ? `<br><br>${settings.signature}` : "") + quotedBody,
        inReplyTo: selectedEmail.messageId,
        references: selectedEmail.messageId,
        accountEmail: selectedEmail.accountEmail,
      });
      setComposeOpen(true);
    } catch {}
  };

  const handleForward = async () => {
    if (!selectedEmail) return;
    try {
      const res = await fetch(`/api/emails/${selectedEmail.id}`, { credentials: "include" });
      const full = await res.json();
      const dateStr = format(new Date(selectedEmail.date), "EEE, MMM d, yyyy 'at' h:mm a");
      const toStr = selectedEmail.to.map((r: any) => `${r.name} &lt;${r.email}&gt;`).join(", ");
      const fwdHeader = `<br><br>---------- Forwarded message ---------<br>From: ${selectedEmail.sender.name} &lt;${selectedEmail.sender.email}&gt;<br>Date: ${dateStr}<br>Subject: ${selectedEmail.subject}<br>To: ${toStr}<br><br>`;
      const fwdSubject = selectedEmail.subject.startsWith("Fwd:") ? selectedEmail.subject : `Fwd: ${selectedEmail.subject}`;
      setComposeDefaults({
        subject: fwdSubject,
        body: (settings?.signature ? `<br><br>${settings.signature}` : "") + fwdHeader + sanitizeForCompose(full.bodyHtml || full.body),
      });
      setComposeOpen(true);
    } catch {}
  };

  const handleForwardAsAttachment = async () => {
    if (!selectedEmail) return;
    try {
      const res = await fetch(`/api/emails/${selectedEmail.id}/eml`, { credentials: "include" });
      const blob = await res.blob();
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const fwdSubject = selectedEmail.subject.startsWith("Fwd:") ? selectedEmail.subject : `Fwd: ${selectedEmail.subject}`;
        setComposeDefaults({
          subject: fwdSubject,
          body: "",
        });
        setComposeOpen(true);
        setTimeout(() => {
          const event = new CustomEvent("add-attachment", {
            detail: {
              name: `${selectedEmail.subject.replace(/[^a-zA-Z0-9 ]/g, "_")}.eml`,
              size: blob.size,
              type: "message/rfc822",
              dataUrl,
            }
          });
          window.dispatchEvent(event);
        }, 100);
      };
      reader.readAsDataURL(blob);
    } catch {}
  };

  const resetSearchAndFilters = () => {
    setSearchQuery("");
    setFilterPanelOpen(false);
    setFilterScope("current");
    setFilterHasAttachment(false);
    setFilterUnread(false);
    setFilterStarred(false);
    setFilterDateRange("");
    setFilterSearchBody(false);
  };

  const handleFolderClick = (folderId: string) => {
    setActiveFolder(folderId);
    setActiveLabel(null);
    setActiveAccount(null);
    setSelectedEmailId(null);
    setSelectedThreadEmails(null);
    setSelectedEmailIds(new Set());
    resetSearchAndFilters();
    setCurrentPage(1);
  };

  const handleLabelClick = (labelId: string) => {
    setActiveLabel(labelId);
    setActiveFolder("");
    setActiveAccount(null);
    setSelectedEmailId(null);
    setSelectedThreadEmails(null);
    setSelectedEmailIds(new Set());
    resetSearchAndFilters();
    setCurrentPage(1);
  };

  const handleAccountClick = (accountEmail: string) => {
    setActiveAccount(accountEmail);
    setActiveFolder("");
    setActiveLabel(null);
    setSelectedEmailId(null);
    setSelectedThreadEmails(null);
    setSelectedEmailIds(new Set());
    resetSearchAndFilters();
    setCurrentPage(1);
  };

  useEffect(() => {
    const handleClickOutside = () => { setSelectMenuOpen(false); };
    if (selectMenuOpen) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [selectMenuOpen]);

  useEffect(() => {
    const handleClickOutside = () => { setMoveMenuOpen(false); };
    if (moveMenuOpen) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [moveMenuOpen]);

  useEffect(() => {
    const handleClickOutside = () => { setFilterPanelOpen(false); };
    if (filterPanelOpen) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [filterPanelOpen]);

  const getLabelById = (id: string) => labels.find(l => l.id === id);

  const visibleFolders = (moreExpanded || sidebarCollapsed) ? FOLDERS : FOLDERS.slice(0, 7);
  const hiddenFolders = FOLDERS.slice(7);

  const accountEmails = accounts.map(a => a.email).filter(Boolean);

  return (
    <div className="flex h-screen w-full max-w-full overflow-hidden bg-[#f6f8fc]" onDragEnd={() => setDragOverFolder(null)}>
      {/* Gmail-style Sidebar */}
      <div className={`${sidebarCollapsed ? "w-[68px]" : "w-[256px]"} flex-shrink-0 flex flex-col h-full pt-2 pl-2 transition-all duration-200`}>
        {/* Branding Header */}
        <div className={`flex items-center ${sidebarCollapsed ? "px-1" : "px-3"} h-12 mb-1`}>
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-2 rounded-full hover:bg-[#e8eaed]/60 text-[#5f6368] transition-colors flex-shrink-0"
            title="Main menu"
            aria-label="Main menu"
            aria-expanded={!sidebarCollapsed}
            data-testid="button-toggle-sidebar"
          >
            <Menu className="w-5 h-5" />
          </button>
          {!sidebarCollapsed && (
            <button
              onClick={() => handleFolderClick("inbox")}
              className="flex items-center gap-1.5 ml-1 cursor-pointer hover:opacity-80 transition-opacity"
              data-testid="button-brand-home"
              title="Go to Inbox"
            >
              <img src={brandIcon} alt="LocalMail" className="w-8 h-8 rounded-full" />
              <span className="text-[22px] text-[#5f6368]" style={{ fontFamily: "'Product Sans', 'Google Sans', Arial, sans-serif" }}>LocalMail</span>
            </button>
          )}
        </div>

        {/* Compose Button */}
        <div className={sidebarCollapsed ? "px-1 py-2 flex justify-center" : "px-3 py-2"}>
          <button
            onClick={() => { setComposeDefaults(null); setComposeOpen(true); }}
            className={`flex items-center ${sidebarCollapsed ? "justify-center w-12 h-12 p-0 rounded-2xl" : "gap-3 px-6 py-3.5 rounded-2xl"} bg-[#c2e7ff] shadow-md hover:shadow-lg transition-shadow`}
            title={sidebarCollapsed ? "Compose" : undefined}
            aria-label="Compose"
            data-testid="button-compose"
          >
            <Pencil className="w-5 h-5 text-[#001d35]" />
            {!sidebarCollapsed && <span className="text-sm font-medium text-[#001d35]">Compose</span>}
          </button>
        </div>

        {/* Folder Navigation */}
        <ScrollArea className="flex-1 mt-2">
          <div className={sidebarCollapsed ? "px-1" : "pr-4"}>
            {visibleFolders.map((folder) => {
              const isActive = !activeLabel && !activeAccount && activeFolder === folder.id;
              const isDropTarget = !["starred", "snoozed", "all"].includes(folder.id);
              const isDragOver = dragOverFolder === folder.id;
              return (
                <button
                  key={folder.id}
                  onClick={() => handleFolderClick(folder.id)}
                  onDragOver={(e) => {
                    if (!isDropTarget) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDragEnter={(e) => {
                    if (!isDropTarget) return;
                    e.preventDefault();
                    setDragOverFolder(folder.id);
                  }}
                  onDragLeave={() => {
                    if (dragOverFolder === folder.id) setDragOverFolder(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverFolder(null);
                    if (!isDropTarget) return;
                    const data = e.dataTransfer.getData("application/localmail-ids");
                    if (!data) return;
                    try {
                      const ids: string[] = JSON.parse(data);
                      if (ids.length > 0) {
                        bulkMoveMutation.mutate({ ids, folder: folder.id });
                      }
                    } catch {}
                  }}
                  className={`w-full flex items-center ${sidebarCollapsed ? "justify-center h-10 rounded-full" : "justify-between pl-6 pr-3 h-8 rounded-r-full"} text-sm transition-colors ${
                    isDragOver
                      ? "bg-[#c2e7ff] text-[#001d35] font-semibold ring-2 ring-[#1a73e8] ring-inset"
                      : isActive
                        ? "bg-[#d3e3fd] text-[#001d35] font-semibold"
                        : "text-[#444746] hover:bg-[#e8eaed]/60"
                  }`}
                  title={sidebarCollapsed ? folder.label : undefined}
                  data-testid={`folder-${folder.id}`}
                >
                  <div className={`flex items-center ${sidebarCollapsed ? "" : "gap-4"}`}>
                    <folder.icon className="w-[18px] h-[18px]" />
                    {!sidebarCollapsed && <span>{folder.label}</span>}
                  </div>
                  {!sidebarCollapsed && folder.id !== "trash" && (unreadCounts[folder.id] || 0) > 0 && (
                    <span className="text-xs font-semibold">{unreadCounts[folder.id]}</span>
                  )}
                </button>
              );
            })}

            {!sidebarCollapsed && !moreExpanded && hiddenFolders.length > 0 && (
              <button
                onClick={() => setMoreExpanded(true)}
                className="w-full flex items-center gap-4 pl-6 pr-3 h-8 text-sm rounded-r-full text-[#444746] hover:bg-[#e8eaed]/60"
              >
                <ChevronDown className="w-[18px] h-[18px]" />
                <span>More</span>
              </button>
            )}

            {/* Custom Folders Section */}
            {!sidebarCollapsed && customFolders.length > 0 && (
              <div className="mt-2 border-t border-[#e0e0e0] dark:border-[#3c4043] pt-2">
                {customFolders.map((cf) => {
                  const isActive = activeFolder === `custom:${cf.id}`;
                  const isDragOver = dragOverFolder === `custom:${cf.id}`;
                  return (
                    <button
                      key={cf.id}
                      onClick={() => handleFolderClick(`custom:${cf.id}`)}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                      onDragEnter={(e) => { e.preventDefault(); setDragOverFolder(`custom:${cf.id}`); }}
                      onDragLeave={() => { if (dragOverFolder === `custom:${cf.id}`) setDragOverFolder(null); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOverFolder(null);
                        const data = e.dataTransfer.getData("application/localmail-ids");
                        if (!data) return;
                        try {
                          const ids: string[] = JSON.parse(data);
                          if (ids.length > 0) bulkMoveMutation.mutate({ ids, folder: `custom:${cf.id}` });
                        } catch {}
                      }}
                      className={`w-full flex items-center gap-4 pl-6 pr-3 h-8 text-sm rounded-r-full transition-colors ${
                        isDragOver
                          ? "bg-[#c2e7ff] text-[#001d35] font-semibold ring-2 ring-[#1a73e8] ring-inset"
                          : isActive
                            ? "bg-[#d3e3fd] text-[#001d35] font-semibold dark:bg-[#004a77] dark:text-[#c2e7ff]"
                            : "text-[#444746] hover:bg-[#e8eaed]/60 dark:text-[#bdc1c6] dark:hover:bg-[#3c4043]/60"
                      }`}
                      data-testid={`folder-custom-${cf.id}`}
                    >
                      <Folder className="w-[18px] h-[18px]" style={{ color: cf.color }} />
                      <span className="truncate flex-1 text-left">{cf.name}</span>
                      {(unreadCounts[`custom:${cf.id}`] || 0) > 0 && (
                        <span className="text-xs font-semibold">{unreadCounts[`custom:${cf.id}`]}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Mail Accounts Section */}
            {!sidebarCollapsed && accountEmails.length > 0 && (
              <div className="mt-4 border-t border-[#e0e0e0] pt-2">
                <button
                  onClick={() => setAccountsExpanded(!accountsExpanded)}
                  className="w-full flex items-center justify-between pl-6 pr-3 h-8 text-sm text-[#444746] hover:bg-[#e8eaed]/60 rounded-r-full"
                >
                  <span className="font-medium text-xs tracking-wide uppercase">Mail Accounts</span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${accountsExpanded ? "" : "-rotate-90"}`} />
                </button>

                {accountsExpanded && (
                  <div>
                    {accountEmails.map((email) => {
                      const isActive = activeAccount === email;
                      const accLabel = labels.find(l => l.name === email);
                      const accColor = accLabel?.color || "#1a73e8";
                      return (
                        <button
                          key={email}
                          onClick={() => handleAccountClick(email)}
                          className={`w-full flex items-center gap-4 pl-6 pr-3 h-8 text-sm rounded-r-full transition-colors ${
                            isActive
                              ? "bg-[#d3e3fd] text-[#001d35] font-semibold"
                              : "text-[#444746] hover:bg-[#e8eaed]/60"
                          }`}
                          data-testid={`account-filter-${email}`}
                        >
                          <AtSign className="w-3.5 h-3.5 flex-shrink-0" style={{ color: accColor }} />
                          <span className="truncate text-xs">{email}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Labels Section */}
            {!sidebarCollapsed && (
            <div className="mt-4 border-t border-[#e0e0e0] pt-2">
              <button
                onClick={() => setLabelsExpanded(!labelsExpanded)}
                className="w-full flex items-center justify-between pl-6 pr-3 h-8 text-sm text-[#444746] hover:bg-[#e8eaed]/60 rounded-r-full"
              >
                <span className="font-medium text-xs tracking-wide uppercase">Labels</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${labelsExpanded ? "" : "-rotate-90"}`} />
              </button>

              {labelsExpanded && (
                <div>
                  {labels.filter(l => !accountEmails.includes(l.name)).map((label) => {
                    const isActive = activeLabel === label.id;
                    return (
                      <button
                        key={label.id}
                        onClick={() => handleLabelClick(label.id)}
                        className={`w-full flex items-center gap-4 pl-6 pr-3 h-8 text-sm rounded-r-full transition-colors ${
                          isActive
                            ? "bg-[#d3e3fd] text-[#001d35] font-semibold"
                            : "text-[#444746] hover:bg-[#e8eaed]/60"
                        }`}
                        data-testid={`label-${label.id}`}
                      >
                        <div
                          className="w-3 h-3 rounded-sm flex-shrink-0"
                          style={{ backgroundColor: label.color }}
                        />
                        <span className="truncate flex-1 text-left">{label.name}</span>
                        {(unreadCounts[`label:${label.id}`] || 0) > 0 && (
                          <span className="text-xs font-semibold">{unreadCounts[`label:${label.id}`]}</span>
                        )}
                      </button>
                    );
                  })}
                  <CreateLabelButton />
                </div>
              )}
            </div>
            )}
          </div>

        </ScrollArea>

        {/* User info + logout */}
        <div className={`border-t border-[#e0e0e0] py-3 flex items-center ${sidebarCollapsed ? "justify-center px-1" : "justify-between px-4"}`}>
          {!sidebarCollapsed && (
            <div className="truncate">
              <div className="text-sm font-medium text-[#202124] truncate">{user.displayName || user.username}</div>
              <div className="text-xs text-[#5f6368]">@{user.username}</div>
            </div>
          )}
          <button
            onClick={() => logoutMutation.mutate()}
            className="p-2 rounded-full hover:bg-[#e8eaed]/60 text-[#5f6368] hover:text-[#202124] transition-colors flex-shrink-0"
            title="Sign out"
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col h-full mr-2 my-2 rounded-2xl bg-white overflow-hidden shadow-sm">
        {/* Top Search Bar */}
        <header className="flex flex-col">
          <div className="h-14 flex items-center px-2 gap-2">
            {selectedEmail && (
              <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-[#f1f3f4] transition-colors" onClick={handleBack} title="Back to list" data-testid="button-back">
                <ArrowLeft className="h-5 w-5 text-[#444746]" />
              </Button>
            )}
            {!selectedEmail && (
              <div className="w-[40%] relative">
                <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-[#5f6368]" />
                <input
                  placeholder="Search mail"
                  className="w-full h-12 pl-12 pr-12 rounded-full text-sm outline-none bg-[#eaf1fb]"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => setFilterPanelOpen(false)}
                  data-testid="input-search"
                />
                {(searchQuery || isFiltering) && (
                  <button
                    onClick={() => resetSearchAndFilters()}
                    className="absolute right-12 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-[#dadce0]/60"
                    data-testid="button-clear-search"
                    title="Clear search and filters"
                  >
                    <X className="w-4 h-4 text-[#5f6368]" />
                  </button>
                )}
                <button
                  className={`absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-full hover:bg-[#dadce0]/60 ${filterPanelOpen ? "bg-[#d3e3fd]" : ""}`}
                  title="Search filters"
                  data-testid="button-search-options"
                  onClick={(e) => { e.stopPropagation(); setFilterPanelOpen(v => !v); }}
                >
                  <Filter className={`w-4 h-4 ${activeFiltersCount > 0 ? "text-[#0b57d0]" : "text-[#5f6368]"}`} />
                  {activeFiltersCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 bg-[#0b57d0] text-white text-[9px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none">{activeFiltersCount}</span>
                  )}
                </button>

                {/* Filter panel dropdown */}
                {filterPanelOpen && (
                  <div className="absolute top-14 right-0 z-50 w-72 bg-white border border-[#dadce0] rounded-2xl shadow-xl p-4 text-sm text-[#3c4043]" onClick={e => e.stopPropagation()} data-testid="filter-panel">
                    <div className="font-medium text-[#202124] mb-3 text-[13px]">Search filters</div>

                    {/* Scope */}
                    <div className="mb-3">
                      <div className="text-[11px] font-medium text-[#5f6368] uppercase tracking-wide mb-1.5">Scope</div>
                      <div className="flex rounded-lg border border-[#dadce0] overflow-hidden">
                        <button
                          className={`flex-1 py-1.5 text-[12px] transition-colors ${filterScope === "current" ? "bg-[#d3e3fd] text-[#0b57d0] font-medium" : "hover:bg-[#f1f3f4]"}`}
                          onClick={() => setFilterScope("current")}
                          data-testid="filter-scope-current"
                        >
                          {activeLabel ? "Current label" : activeAccount ? "Current account" : `Current folder`}
                        </button>
                        <button
                          className={`flex-1 py-1.5 text-[12px] transition-colors ${filterScope === "all" ? "bg-[#d3e3fd] text-[#0b57d0] font-medium" : "hover:bg-[#f1f3f4]"}`}
                          onClick={() => setFilterScope("all")}
                          data-testid="filter-scope-all"
                        >
                          All mail
                        </button>
                      </div>
                    </div>

                    {/* From / Sender filter */}
                    <div className="mb-3">
                      <div className="text-[11px] font-medium text-[#5f6368] uppercase tracking-wide mb-1.5">From / Sender</div>
                      <input
                        type="text"
                        className="w-full border border-[#dadce0] rounded-lg px-3 py-1.5 text-[12px] bg-white focus:outline-none focus:border-[#0b57d0]"
                        placeholder="Name or email address…"
                        value={filterFrom}
                        onChange={e => setFilterFrom(e.target.value)}
                        data-testid="filter-from"
                      />
                    </div>

                    {/* Date range */}
                    <div className="mb-3">
                      <div className="text-[11px] font-medium text-[#5f6368] uppercase tracking-wide mb-1.5">Date range</div>
                      <select
                        className="w-full border border-[#dadce0] rounded-lg px-3 py-1.5 text-[12px] bg-white focus:outline-none focus:border-[#0b57d0]"
                        value={filterDateRange}
                        onChange={e => setFilterDateRange(e.target.value)}
                        data-testid="filter-date-range"
                      >
                        <option value="">All time</option>
                        <option value="7d">Last 7 days</option>
                        <option value="30d">Last 30 days</option>
                        <option value="90d">Last 3 months</option>
                        <option value="1y">Last year</option>
                      </select>
                    </div>

                    {/* Toggles */}
                    <div className="space-y-2 mb-3">
                      <div className="text-[11px] font-medium text-[#5f6368] uppercase tracking-wide mb-1.5">Show only</div>
                      {[
                        { label: "Has attachment", value: filterHasAttachment, setter: setFilterHasAttachment, testId: "filter-has-attachment" },
                        { label: "Unread only", value: filterUnread, setter: setFilterUnread, testId: "filter-unread" },
                        { label: "Starred only", value: filterStarred, setter: setFilterStarred, testId: "filter-starred" },
                        { label: "Search in email body", value: filterSearchBody, setter: setFilterSearchBody, testId: "filter-search-body" },
                      ].map(({ label, value, setter, testId }) => (
                        <label key={testId} className="flex items-center gap-2.5 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={value}
                            onChange={e => setter(e.target.checked)}
                            className="w-4 h-4 accent-[#0b57d0] cursor-pointer rounded"
                            data-testid={testId}
                          />
                          <span className="text-[13px] group-hover:text-[#0b57d0] transition-colors">{label}</span>
                        </label>
                      ))}
                    </div>

                    {/* Operator hint */}
                    <div className="border-t border-[#f0f0f0] pt-3 mt-1">
                      <div className="text-[11px] font-medium text-[#5f6368] uppercase tracking-wide mb-1.5">Search operators</div>
                      <div className="text-[11px] text-[#80868b] space-y-0.5">
                        <div><span className="font-mono bg-[#f1f3f4] px-1 rounded">from:alice</span> — filter by sender</div>
                        <div><span className="font-mono bg-[#f1f3f4] px-1 rounded">subject:invoice</span> — match subject</div>
                        <div><span className="font-mono bg-[#f1f3f4] px-1 rounded">has:attachment</span> — has files</div>
                      </div>
                    </div>

                    {/* Clear button */}
                    {activeFiltersCount > 0 && (
                      <button
                        className="mt-3 w-full text-center text-[12px] text-[#c5221f] hover:text-[#a50e0e] font-medium"
                        onClick={() => { setFilterScope("current"); setFilterHasAttachment(false); setFilterUnread(false); setFilterStarred(false); setFilterDateRange(""); setFilterSearchBody(false); setFilterFrom(""); }}
                        data-testid="filter-clear-all"
                      >
                        Clear all filters
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="flex-1" />
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 rounded-full"
                onClick={() => setSettingsOpen(true)}
                title="Settings"
                data-testid="button-settings"
              >
                <Settings className="h-5 w-5 text-[#444746]" />
              </Button>
            </div>
          </div>

          {/* Select toolbar - only show in list view */}
          {!selectedEmail && (
            <div className="h-10 flex items-center px-2 gap-0.5 border-b border-[#e0e0e0]">
              <div className="relative">
                <div className="flex items-center">
                  <button
                    onClick={() => {
                      if (selectedEmailIds.size === 0) selectAllEmails();
                      else selectNoneEmails();
                    }}
                    className="p-1.5 rounded hover:bg-[#f1f3f4] text-[#5f6368]"
                    title={selectedEmailIds.size > 0 ? "Deselect all" : "Select all"}
                    data-testid="button-select-toggle"
                  >
                    {selectedEmailIds.size === 0 ? (
                      <div className="w-[18px] h-[18px] border-2 border-[#5f6368] rounded-sm" />
                    ) : selectedEmailIds.size === emails.length ? (
                      <SquareCheck className="w-[18px] h-[18px]" />
                    ) : (
                      <Minus className="w-[18px] h-[18px]" />
                    )}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setSelectMenuOpen(!selectMenuOpen); }}
                    className="p-0.5 rounded hover:bg-[#f1f3f4] text-[#5f6368]"
                    data-testid="button-select-dropdown"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
                {selectMenuOpen && (
                  <div className="absolute top-full left-0 mt-1 bg-white border border-[#dadce0] rounded-lg shadow-lg py-1 w-32 z-20" data-testid="select-dropdown-menu">
                    <button onClick={selectAllEmails} className="w-full text-left px-4 py-1.5 text-sm text-[#3c4043] hover:bg-[#f1f3f4]" data-testid="select-all">All</button>
                    <button onClick={selectNoneEmails} className="w-full text-left px-4 py-1.5 text-sm text-[#3c4043] hover:bg-[#f1f3f4]" data-testid="select-none">None</button>
                    <button onClick={selectReadEmails} className="w-full text-left px-4 py-1.5 text-sm text-[#3c4043] hover:bg-[#f1f3f4]" data-testid="select-read">Read</button>
                    <button onClick={selectUnreadEmails} className="w-full text-left px-4 py-1.5 text-sm text-[#3c4043] hover:bg-[#f1f3f4]" data-testid="select-unread">Unread</button>
                    <button onClick={selectStarredEmails} className="w-full text-left px-4 py-1.5 text-sm text-[#3c4043] hover:bg-[#f1f3f4]" data-testid="select-starred">Starred</button>
                    <button onClick={selectUnstarredEmails} className="w-full text-left px-4 py-1.5 text-sm text-[#3c4043] hover:bg-[#f1f3f4]" data-testid="select-unstarred">Unstarred</button>
                  </div>
                )}
              </div>

              {selectedEmailIds.size > 0 ? (
                <>
                  {activeFolder === "trash" && (
                    <button
                      onClick={() => bulkPermanentDeleteMutation.mutate(Array.from(selectedEmailIds))}
                      disabled={isBulkBusy}
                      className="flex items-center gap-1 px-3 py-1 text-sm text-[#3c4043] border border-[#dadce0] rounded hover:bg-[#f1f3f4] hover:shadow-sm transition-colors disabled:opacity-50 disabled:pointer-events-none"
                      data-testid="button-bulk-permanent-delete"
                    >
                      {bulkPermanentDeleteMutation.isPending ? "Deleting..." : "Delete forever"}
                    </button>
                  )}
                  {activeFolder === "spam" ? (
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-[#f1f3f4] transition-colors" title="Not spam" data-testid="button-bulk-not-spam"
                      disabled={isBulkBusy}
                      onClick={() => bulkNotSpamMutation.mutate(Array.from(selectedEmailIds))}>
                      <ShieldCheck className="h-[18px] w-[18px] text-[#5f6368]" />
                    </Button>
                  ) : (
                    <>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-[#f1f3f4] transition-colors" title="Archive" data-testid="button-bulk-archive"
                        disabled={isBulkBusy}
                        onClick={() => bulkArchiveMutation.mutate(Array.from(selectedEmailIds))}>
                        <Archive className="h-[18px] w-[18px] text-[#5f6368]" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-[#f1f3f4] transition-colors" title="Mark as spam" data-testid="button-bulk-spam"
                        disabled={isBulkBusy}
                        onClick={() => bulkMarkAsSpamMutation.mutate(Array.from(selectedEmailIds))}>
                        <AlertCircle className="h-[18px] w-[18px] text-[#5f6368]" />
                      </Button>
                    </>
                  )}
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-[#f1f3f4] transition-colors" title="Delete" data-testid="button-bulk-delete"
                    disabled={isBulkBusy}
                    onClick={() => bulkDeleteMutation.mutate(Array.from(selectedEmailIds))}>
                    <Trash2 className="h-[18px] w-[18px] text-[#5f6368]" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-[#f1f3f4] transition-colors" title="Mark as read" data-testid="button-bulk-read"
                    disabled={isBulkBusy}
                    onClick={() => bulkReadMutation.mutate({ ids: Array.from(selectedEmailIds), isUnread: false })}>
                    <MailOpen className="h-[18px] w-[18px] text-[#5f6368]" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-[#f1f3f4] transition-colors" title="Mark as unread" data-testid="button-bulk-unread"
                    disabled={isBulkBusy}
                    onClick={() => bulkReadMutation.mutate({ ids: Array.from(selectedEmailIds), isUnread: true })}>
                    <Mail className="h-[18px] w-[18px] text-[#5f6368]" />
                  </Button>
                  <Separator orientation="vertical" className="h-5 mx-1" />
                  <div className="relative">
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-[#f1f3f4] transition-colors" title="Move to" data-testid="button-bulk-move"
                      disabled={isBulkBusy}
                      onClick={(e) => { e.stopPropagation(); setMoveMenuOpen(!moveMenuOpen); }}>
                      <FolderInput className="h-[18px] w-[18px] text-[#5f6368]" />
                    </Button>
                    {moveMenuOpen && (
                      <div className="absolute top-full left-0 mt-1 bg-white border border-[#dadce0] rounded-lg shadow-lg py-1 w-40 z-20" data-testid="move-dropdown-menu">
                        {FOLDERS.filter(f => f.id !== "all" && f.id !== activeFolder).map(folder => (
                          <button
                            key={folder.id}
                            onClick={() => bulkMoveMutation.mutate({ ids: Array.from(selectedEmailIds), folder: folder.id })}
                            className="w-full text-left px-4 py-1.5 text-sm text-[#3c4043] hover:bg-[#f1f3f4] flex items-center gap-3"
                            data-testid={`move-to-${folder.id}`}
                          >
                            <folder.icon className="w-4 h-4 text-[#5f6368]" />
                            {folder.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-[#f1f3f4] transition-colors" title="Add star" data-testid="button-bulk-star"
                    disabled={isBulkBusy}
                    onClick={() => bulkStarMutation.mutate(Array.from(selectedEmailIds))}>
                    <Star className="h-[18px] w-[18px] text-[#5f6368]" />
                  </Button>
                  <span className="ml-2 text-xs text-[#5f6368]">{selectedEmailIds.size} selected</span>
                </>
              ) : (
                <>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-[#f1f3f4] transition-colors" title="Refresh"
                    onClick={() => queryClient.invalidateQueries()} data-testid="button-toolbar-refresh">
                    <RefreshCw className={`h-[18px] w-[18px] text-[#5f6368] ${emailsQuery.isFetching ? "animate-spin" : ""}`} />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-[#f1f3f4] transition-colors" title="More" data-testid="button-toolbar-more">
                    <MoreVertical className="h-[18px] w-[18px] text-[#5f6368]" />
                  </Button>
                </>
              )}
              <div className="flex-1" />
              <div className="flex items-center gap-0.5 text-xs text-[#5f6368]">
                <span data-testid="text-pagination-info">
                  {allEmails.length === 0 ? "0" : `${(safePage - 1) * perPage + 1}–${Math.min(safePage * perPage, allEmails.length)}`} of {allEmails.length}
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="p-1.5 rounded-full hover:bg-[#f1f3f4] disabled:opacity-30 disabled:cursor-default"
                  data-testid="button-page-prev"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className="p-1.5 rounded-full hover:bg-[#f1f3f4] disabled:opacity-30 disabled:cursor-default"
                  data-testid="button-page-next"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </header>

        {/* Email List OR Thread View OR Email View */}
        {!selectedEmail && !selectedThreadEmails ? (
          <div className="flex-1 flex flex-col min-h-0">
            {isFiltering && !emailsQuery.isLoading && (
              <div className="flex items-center gap-2 px-4 py-1.5 bg-[#f6f8fc] border-b border-[#e0e0e0] text-[12px] text-[#5f6368]" data-testid="search-result-count">
                <Search className="h-3.5 w-3.5 flex-shrink-0" />
                <span>
                  <span className="font-medium text-[#202124]">{allEmails.length}</span> result{allEmails.length !== 1 ? "s" : ""}
                  {searchQuery && <span> for &ldquo;<span className="font-medium text-[#202124]">{searchQuery}</span>&rdquo;</span>}
                  {filterScope === "current" && <span className="ml-1 text-[#80868b]">· {activeLabel ? "Current label" : activeAccount ? "Current account" : activeFolder.charAt(0).toUpperCase() + activeFolder.slice(1)}</span>}
                  {filterScope === "all" && <span className="ml-1 text-[#80868b]">· All mail</span>}
                </span>
              </div>
            )}
            {activeFolder === "spam" && (
              <div className="flex items-center gap-2 px-4 py-2 bg-[#fef7e0] border-b border-[#f5d565] text-[12px] text-[#7a5c00]" data-testid="spam-banner">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 text-[#b06000]" />
                <span>Spam is automatically emptied after <strong>{settings?.spamRetentionDays || 30} days</strong>. Messages in here will not appear in search results.</span>
              </div>
            )}
            <EmailList
              emails={emails}
              isLoading={emailsQuery.isLoading}
              labels={labels}
              onSelect={handleSelectEmail}
              onStar={(id) => starMutation.mutate(id)}
              displayDensity={settings?.displayDensity || "default"}
              showLabels={settings?.showLabels !== false}
              selectedIds={selectedEmailIds}
              onToggleSelect={toggleEmailSelection}
              clockFormat={settings?.clockFormat || "12h"}
              conversationView={settings?.conversationView !== false}
              customFolders={customFolders}
              activeFolder={activeFolder}
              onArchive={(id) => { archiveMutation.mutate(id); }}
              onDelete={(id) => { deleteMutation.mutate(id); }}
              onMarkRead={(id, isUnread) => readMutation.mutate({ id, isUnread })}
              onMoveToFolder={(id, folder) => bulkMoveMutation.mutate({ ids: [id], folder })}
              onAddLabel={(emailId, labelId) => addLabelMutation.mutate({ emailId, labelId })}
              onMarkAsSpam={(id) => markAsSpamMutation.mutate(id)}
              onNotSpam={(id) => notSpamMutation.mutate(id)}
              onBlockSender={(id, email, name) => blockSenderMutation.mutate({ emailId: id, senderEmail: email, senderName: name })}
              onSelectThread={handleSelectThread}
              searchQuery={searchQuery}
            />
          </div>
        ) : selectedThreadEmails ? (
          <ThreadView
            emails={selectedThreadEmails}
            labels={labels}
            showLabels={settings?.showLabels !== false}
            onBack={handleBack}
            onArchive={(id) => archiveMutation.mutate(id)}
            onDelete={(id) => deleteMutation.mutate(id)}
            onStar={(id) => starMutation.mutate(id)}
            onToggleRead={(id, isUnread) => readMutation.mutate({ id, isUnread })}
            clockFormat={settings?.clockFormat || "12h"}
            onOpenCompose={(defaults) => { setComposeDefaults(defaults); setComposeOpen(true); }}
          />
        ) : (
          <EmailView
            email={selectedEmail!}
            labels={labels}
            showLabels={settings?.showLabels !== false}
            activeFolder={activeFolder}
            onBack={handleBack}
            onArchive={() => archiveMutation.mutate(selectedEmail!.id)}
            onDelete={() => deleteMutation.mutate(selectedEmail!.id)}
            onStar={() => starMutation.mutate(selectedEmail!.id)}
            onToggleRead={() => readMutation.mutate({ id: selectedEmail!.id, isUnread: !selectedEmail!.isUnread })}
            onAddLabel={(labelId) => addLabelMutation.mutate({ emailId: selectedEmail!.id, labelId })}
            onRemoveLabel={(labelId) => removeLabelMutation.mutate({ emailId: selectedEmail!.id, labelId })}
            onMarkAsSpam={() => markAsSpamMutation.mutate(selectedEmail!.id)}
            onNotSpam={() => notSpamMutation.mutate(selectedEmail!.id)}
            onBlockSender={() => blockSenderMutation.mutate({ emailId: selectedEmail!.id, senderEmail: selectedEmail!.sender.email, senderName: selectedEmail!.sender.name })}
            onUnsubscribe={() => unsubscribeMutation.mutate(selectedEmail!.id)}
            isUnsubscribing={unsubscribeMutation.isPending}
            onReply={handleReply}
            onReplyAll={handleReplyAll}
            onForward={handleForward}
            onForwardAsAttachment={handleForwardAsAttachment}
            clockFormat={settings?.clockFormat || "12h"}
            signature={settings?.signature || ""}
            sendCancellation={settings?.sendCancellation || 0}
            defaultSendAccountId={settings?.defaultSendAccountId || ""}
            replyStyle={settings?.replyStyle || "popout"}
            onPopOutCompose={(defaults) => {
              setComposeDefaults(defaults);
              setComposeOpen(true);
            }}
          />
        )}
      </div>

      <ComposePanel open={composeOpen} onClose={() => { setComposeOpen(false); setComposeDefaults(null); }} signature={settings?.signature || ""} sendCancellation={settings?.sendCancellation || 0} defaultSendAccountId={settings?.defaultSendAccountId || ""} defaults={composeDefaults} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query || !query.trim()) return <>{text}</>;
  const q = query.trim().toLowerCase();
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-[#fff2a8] text-inherit rounded-sm px-0 font-semibold">{text.slice(idx, idx + q.length)}</mark>
      <HighlightText text={text.slice(idx + q.length)} query={query} />
    </>
  );
}

function EmailList({
  emails,
  isLoading,
  labels,
  onSelect,
  onStar,
  displayDensity,
  showLabels,
  selectedIds,
  onToggleSelect,
  clockFormat,
  conversationView,
  customFolders,
  activeFolder,
  onArchive,
  onDelete,
  onMarkRead,
  onMoveToFolder,
  onAddLabel,
  onMarkAsSpam,
  onNotSpam,
  onBlockSender,
  onSelectThread,
  searchQuery = "",
}: {
  emails: Email[];
  isLoading: boolean;
  labels: EmailLabel[];
  onSelect: (email: Email) => void;
  onStar: (id: string) => void;
  displayDensity: "default" | "comfortable" | "compact";
  showLabels: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  clockFormat: "12h" | "24h";
  conversationView: boolean;
  customFolders: CustomFolder[];
  activeFolder: string;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onMarkRead: (id: string, isUnread: boolean) => void;
  onMoveToFolder: (id: string, folder: string) => void;
  onAddLabel: (emailId: string, labelId: string) => void;
  onMarkAsSpam: (id: string) => void;
  onNotSpam: (id: string) => void;
  onBlockSender: (id: string, senderEmail: string, senderName: string) => void;
  onSelectThread: (emails: Email[]) => void;
  searchQuery?: string;
}) {
  const getLabelById = (id: string) => labels.find(l => l.id === id);
  const rowHeight = displayDensity === "compact" ? "h-8" : displayDensity === "comfortable" ? "h-12" : "h-10";

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; email: Email } | null>(null);
  const [ctxSubMenu, setCtxSubMenu] = useState<"folder" | "label" | null>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    document.addEventListener("click", close);
    document.addEventListener("scroll", close, true);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("scroll", close, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu]);

  const threads = useMemo(() => {
    if (!conversationView) return emails.map(e => [e]);
    const map = new Map<string, Email[]>();
    for (const email of [...emails].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())) {
      const key = normalizeSubject(email.subject) || email.id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(email);
    }
    const groups = Array.from(map.values());
    groups.sort((a, b) => {
      const latestA = Math.max(...a.map(e => new Date(e.date).getTime()));
      const latestB = Math.max(...b.map(e => new Date(e.date).getTime()));
      return latestB - latestA;
    });
    return groups;
  }, [emails, conversationView]);

  const allFolders = [
    ...FOLDERS.filter(f => !["starred", "snoozed", "all"].includes(f.id)),
    ...customFolders.map(cf => ({ id: `custom:${cf.id}`, label: cf.name })),
  ];

  if (isLoading) {
    return <div className="flex-1 flex items-center justify-center text-sm text-[#5f6368]">Loading...</div>;
  }

  if (emails.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-[#5f6368]">
        <Mail className="h-16 w-16 mb-4 opacity-20" />
        <p className="text-lg">No conversations</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden relative">
      <div className="pb-16">
        {threads.map((threadEmails) => {
          const latestEmail = threadEmails[threadEmails.length - 1];
          const hasUnread = threadEmails.some(e => e.isUnread);
          const hasAttachments = threadEmails.some(e => e.hasAttachments);
          const count = threadEmails.length;
          const uniqueSenders = Array.from(new Set(threadEmails.map(e => e.sender.name)));
          const senderDisplay = uniqueSenders.length > 2
            ? `${uniqueSenders[0]}, ${uniqueSenders[1]} +${uniqueSenders.length - 2}`
            : uniqueSenders.join(", ");

          return (
            <div
              key={latestEmail.id}
              onClick={() => {
                if (count > 1 && conversationView) {
                  onSelectThread(threadEmails);
                } else {
                  onSelect(latestEmail);
                }
              }}
              draggable
              onDragStart={(e) => {
                const ids = selectedIds.has(latestEmail.id) && selectedIds.size > 1
                  ? Array.from(selectedIds)
                  : [latestEmail.id];
                e.dataTransfer.setData("application/localmail-ids", JSON.stringify(ids));
                e.dataTransfer.effectAllowed = "move";
                const ghost = document.createElement("div");
                ghost.textContent = ids.length > 1 ? `${ids.length} conversations` : (latestEmail.subject || "(no subject)");
                ghost.style.cssText = "position:absolute;top:-1000px;padding:6px 12px;background:#1a73e8;color:white;border-radius:8px;font-size:13px;font-family:sans-serif;white-space:nowrap;";
                document.body.appendChild(ghost);
                e.dataTransfer.setDragImage(ghost, 0, 0);
                requestAnimationFrame(() => document.body.removeChild(ghost));
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtxMenu({ x: e.clientX, y: e.clientY, email: latestEmail });
                setCtxSubMenu(null);
              }}
              className={`flex items-center ${rowHeight} px-2 border-b border-[#f0f0f0] cursor-pointer group transition-colors min-w-0 overflow-hidden ${
                selectedIds.has(latestEmail.id) ? "bg-[#c2dbff]" : hasUnread ? "bg-white" : "bg-[#f2f2f2]"
              } hover:shadow-[inset_1px_0_0_#dadce0,_inset_-1px_0_0_#dadce0,_0_1px_2px_0_rgba(60,64,67,.3),_0_1px_3px_1px_rgba(60,64,67,.15)] hover:z-10 relative`}
              data-testid={`email-row-${latestEmail.id}`}
            >
              {/* Checkbox */}
              <div className="w-10 flex-shrink-0 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={selectedIds.has(latestEmail.id)} onChange={() => onToggleSelect(latestEmail.id)} className="w-[18px] h-[18px] accent-[#1a73e8] cursor-pointer rounded-sm" data-testid={`checkbox-email-${latestEmail.id}`} />
              </div>

              {/* Star */}
              <button
                onClick={(e) => { e.stopPropagation(); onStar(latestEmail.id); }}
                className="w-8 flex-shrink-0 flex items-center justify-center"
                title={latestEmail.isStarred ? "Starred" : "Not starred"}
                data-testid={`button-star-${latestEmail.id}`}
              >
                <Star className={`h-[18px] w-[18px] ${latestEmail.isStarred ? "fill-[#f4b400] text-[#f4b400]" : "text-[#c4c7c5] group-hover:text-[#5f6368]"}`} />
              </button>

              {/* Sender(s) */}
              <div className={`w-[100px] lg:w-[140px] xl:w-[200px] flex-shrink-0 truncate text-[13px] pl-2 ${hasUnread ? "font-bold text-[#202124]" : "font-normal text-[#5f6368]"}`}>
                <HighlightText text={senderDisplay} query={searchQuery} />
                {conversationView && count > 1 && (
                  <span className="ml-1 text-[11px] text-[#5f6368] font-normal">({count})</span>
                )}
              </div>

              {/* Account tag + Subject + Labels + Snippet */}
              <div className="flex-1 flex items-center min-w-0 gap-1 px-2 overflow-hidden">
                {latestEmail.accountEmail && (() => {
                  const accountLabel = labels.find(l => l.name === latestEmail.accountEmail);
                  const tagColor = accountLabel?.color || "#1a73e8";
                  return (
                    <span className="inline-flex items-center px-1.5 py-0 rounded text-[11px] font-medium flex-shrink-0" style={{ backgroundColor: tagColor + "18", color: tagColor, borderWidth: 1, borderColor: tagColor + "40" }} data-testid={`tag-account-${latestEmail.id}`}>
                      {latestEmail.accountEmail}
                    </span>
                  );
                })()}
                {latestEmail.sendStatus === "sending" && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 bg-[#fef7e0] text-[#b06000] border border-[#f5d565]" data-testid={`status-sending-${latestEmail.id}`}>Sending...</span>
                )}
                {latestEmail.sendStatus === "failed" && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 bg-[#fce8e6] text-[#c5221f] border border-[#f5c6c2]" title={latestEmail.sendError} data-testid={`status-failed-${latestEmail.id}`}>Send failed</span>
                )}
                <span className={`truncate text-[13px] ${hasUnread ? "font-bold text-[#202124]" : "font-normal text-[#5f6368]"}`}>
                  <HighlightText text={latestEmail.subject || ""} query={searchQuery} />
                </span>
                {showLabels && latestEmail.labels && latestEmail.labels.length > 0 && latestEmail.labels.map(lId => {
                  const lbl = getLabelById(lId);
                  if (!lbl) return null;
                  if (latestEmail.accountEmail && lbl.name === latestEmail.accountEmail) return null;
                  return (
                    <span key={lId} className="inline-flex items-center px-1.5 py-0 rounded text-[11px] font-medium flex-shrink-0" style={{ backgroundColor: lbl.color + "18", color: lbl.color, border: `1px solid ${lbl.color}40` }}>
                      {lbl.name}
                    </span>
                  );
                })}
                <span className="text-[13px] text-[#5f6368] truncate font-normal">{" "}&mdash; {latestEmail.snippet}</span>
              </div>

              {/* Attachment indicator */}
              {hasAttachments && (
                <div className="w-5 flex-shrink-0 flex items-center justify-center" title="Has attachments">
                  <Paperclip className="h-3.5 w-3.5 text-[#5f6368]" />
                </div>
              )}

              {/* Date */}
              <div className={`w-[75px] flex-shrink-0 text-right text-[12px] pr-2 xl:pr-4 whitespace-nowrap ${hasUnread ? "font-bold text-[#202124]" : "text-[#5f6368]"}`}>
                {formatEmailDate(latestEmail.date, clockFormat)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Context Menu */}
      {ctxMenu && (
        <div
          className="fixed z-50 bg-white border border-[#dadce0] rounded-lg shadow-xl py-1 text-sm text-[#3c4043] min-w-[190px]"
          style={{ left: Math.min(ctxMenu.x, window.innerWidth - 200), top: Math.min(ctxMenu.y, window.innerHeight - 280) }}
          onClick={(e) => e.stopPropagation()}
          data-testid="context-menu"
        >
          <button className="w-full text-left px-4 py-2 hover:bg-[#f1f3f4] flex items-center gap-2.5" onClick={() => { onStar(ctxMenu.email.id); setCtxMenu(null); }} data-testid="ctx-star">
            <Star className="h-4 w-4 flex-shrink-0" />{ctxMenu.email.isStarred ? "Remove star" : "Add star"}
          </button>
          <button className="w-full text-left px-4 py-2 hover:bg-[#f1f3f4] flex items-center gap-2.5" onClick={() => { onMarkRead(ctxMenu.email.id, !ctxMenu.email.isUnread); setCtxMenu(null); }} data-testid="ctx-read">
            <MailOpen className="h-4 w-4 flex-shrink-0" />{ctxMenu.email.isUnread ? "Mark as read" : "Mark as unread"}
          </button>
          <div className="border-t border-[#f0f0f0] my-1" />
          {activeFolder === "spam" ? (
            <button className="w-full text-left px-4 py-2 hover:bg-[#f1f3f4] flex items-center gap-2.5" onClick={() => { onNotSpam(ctxMenu.email.id); setCtxMenu(null); }} data-testid="ctx-not-spam">
              <ShieldCheck className="h-4 w-4 flex-shrink-0" />Not spam
            </button>
          ) : (
            <button className="w-full text-left px-4 py-2 hover:bg-[#f1f3f4] flex items-center gap-2.5" onClick={() => { onArchive(ctxMenu.email.id); setCtxMenu(null); }} data-testid="ctx-archive">
              <Archive className="h-4 w-4 flex-shrink-0" />Archive
            </button>
          )}
          {activeFolder !== "spam" && (
            <button className="w-full text-left px-4 py-2 hover:bg-[#f1f3f4] flex items-center gap-2.5" onClick={() => { onMarkAsSpam(ctxMenu.email.id); setCtxMenu(null); }} data-testid="ctx-spam">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />Mark as spam
            </button>
          )}
          <button className="w-full text-left px-4 py-2 hover:bg-[#f1f3f4] flex items-center gap-2.5" onClick={() => { onDelete(ctxMenu.email.id); setCtxMenu(null); }} data-testid="ctx-delete">
            <Trash2 className="h-4 w-4 flex-shrink-0" />Move to Trash
          </button>
          <div className="border-t border-[#f0f0f0] my-1" />
          <div className="relative" onMouseEnter={() => setCtxSubMenu("folder")} onMouseLeave={() => setCtxSubMenu(null)}>
            <button className="w-full text-left px-4 py-2 hover:bg-[#f1f3f4] flex items-center justify-between gap-2" data-testid="ctx-move">
              <span className="flex items-center gap-2.5"><FolderInput className="h-4 w-4 flex-shrink-0" />Move to</span>
              <ChevronRight className="h-3.5 w-3.5 text-[#5f6368]" />
            </button>
            {ctxSubMenu === "folder" && (
              <div className="absolute left-full top-0 bg-white border border-[#dadce0] rounded-lg shadow-xl py-1 min-w-[150px] z-50">
                {allFolders.map(f => (
                  <button key={f.id} className="w-full text-left px-4 py-2 hover:bg-[#f1f3f4] text-sm" onClick={() => { onMoveToFolder(ctxMenu.email.id, f.id); setCtxMenu(null); }}>
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {labels.length > 0 && (
            <div className="relative" onMouseEnter={() => setCtxSubMenu("label")} onMouseLeave={() => setCtxSubMenu(null)}>
              <button className="w-full text-left px-4 py-2 hover:bg-[#f1f3f4] flex items-center justify-between gap-2" data-testid="ctx-label">
                <span className="flex items-center gap-2.5"><Tag className="h-4 w-4 flex-shrink-0" />Label as</span>
                <ChevronRight className="h-3.5 w-3.5 text-[#5f6368]" />
              </button>
              {ctxSubMenu === "label" && (
                <div className="absolute left-full top-0 bg-white border border-[#dadce0] rounded-lg shadow-xl py-1 min-w-[150px] z-50">
                  {labels.map(l => (
                    <button key={l.id} className="w-full text-left px-4 py-2 hover:bg-[#f1f3f4] flex items-center gap-2.5 text-sm" onClick={() => { onAddLabel(ctxMenu.email.id, l.id); setCtxMenu(null); }}>
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: l.color }} />
                      {l.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="border-t border-[#f0f0f0] my-1" />
          <button className="w-full text-left px-4 py-2 hover:bg-[#f1f3f4] flex items-center gap-2.5 text-[#c5221f]" onClick={() => { onBlockSender(ctxMenu.email.id, ctxMenu.email.sender.email, ctxMenu.email.sender.name); setCtxMenu(null); }} data-testid="ctx-block-sender">
            <Ban className="h-4 w-4 flex-shrink-0" />Block sender
          </button>
        </div>
      )}
    </div>
  );
}

function ThreadEmailCard({
  email,
  expanded,
  onToggle,
  clockFormat,
  onStar,
  onReply,
  onReplyAll,
  onForward,
}: {
  email: Email;
  expanded: boolean;
  onToggle: () => void;
  clockFormat: "12h" | "24h";
  onStar: () => void;
  onReply: (fullEmail: Email) => void;
  onReplyAll: (fullEmail: Email) => void;
  onForward: (fullEmail: Email) => void;
}) {
  const fullEmailQuery = useQuery<Email>({
    queryKey: [`/api/emails/${email.id}`],
    enabled: expanded,
  });
  const fullEmail = fullEmailQuery.data || email;
  const bodyHtmlContent = fullEmail.bodyHtml || (/<[a-z][\s\S]*>/i.test(fullEmail.body) ? fullEmail.body : "");

  const sanitizedHtml = useMemo(() => {
    if (!expanded || !bodyHtmlContent) return "";
    let html = bodyHtmlContent;
    if (fullEmail.attachments) {
      for (const att of fullEmail.attachments) {
        if (att.cid) {
          html = html.replace(
            new RegExp(`cid:${att.cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
            `/api/emails/${email.id}/attachments/${att.id}`
          );
        }
      }
    }
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
    const result = DOMPurify.sanitize(html, {
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'button'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
      ADD_ATTR: ['target', 'rel', 'align', 'valign', 'width', 'height', 'bgcolor', 'cellpadding', 'cellspacing', 'border', 'background', 'style'],
      ADD_TAGS: ['img', 'picture', 'source'],
      ALLOW_DATA_ATTR: false,
    });
    DOMPurify.removeHook('afterSanitizeAttributes');
    return result;
  }, [expanded, bodyHtmlContent, fullEmail.attachments, email.id]);

  const toLine = email.to?.map(t => t.name || t.email).join(", ") || "";

  return (
    <div className="border border-[#dadce0] rounded-xl overflow-hidden bg-white dark:bg-[#2d2e30] dark:border-[#3c4043] shadow-sm">
      <div
        className="flex items-center px-4 py-3 cursor-pointer hover:bg-[#f6f8fc] dark:hover:bg-[#35363a] gap-3 select-none"
        onClick={onToggle}
        data-testid={`thread-card-${email.id}`}
      >
        <div className="w-8 h-8 rounded-full bg-[#1a73e8] text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
          {(email.sender.name || email.sender.email).charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-sm ${email.isUnread ? "font-bold text-[#202124] dark:text-[#e8eaed]" : "text-[#3c4043] dark:text-[#bdc1c6]"}`}>
              {email.sender.name || email.sender.email}
            </span>
            {!expanded && (
              <span className="text-xs text-[#5f6368] truncate">{email.snippet}</span>
            )}
          </div>
          {expanded && toLine && (
            <div className="text-xs text-[#5f6368] truncate">to {toLine}</div>
          )}
        </div>
        <div className="flex items-center gap-2 ml-2 flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onStar(); }}
            title={email.isStarred ? "Remove star" : "Add star"}
            className="p-1 rounded-full hover:bg-[#f1f3f4] dark:hover:bg-[#3c4043]"
          >
            <Star className={`h-4 w-4 ${email.isStarred ? "fill-[#f4b400] text-[#f4b400]" : "text-[#c4c7c5]"}`} />
          </button>
          <span className="text-xs text-[#5f6368] whitespace-nowrap">{formatEmailDate(email.date, clockFormat)}</span>
          {expanded ? <ChevronUp className="h-4 w-4 text-[#5f6368]" /> : <ChevronDown className="h-4 w-4 text-[#5f6368]" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[#f0f0f0] dark:border-[#3c4043]">
          {fullEmailQuery.isLoading ? (
            <div className="py-12 text-center text-sm text-[#5f6368]">
              <Loader2 className="h-5 w-5 animate-spin mx-auto" />
            </div>
          ) : (
            <div className="px-6 py-4">
              {bodyHtmlContent ? (
                <div className="email-html-body overflow-x-auto" dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />
              ) : (
                <pre className="text-sm text-[#3c4043] dark:text-[#bdc1c6] whitespace-pre-wrap font-sans leading-relaxed">{fullEmail.body}</pre>
              )}
              {fullEmail.attachments && fullEmail.attachments.some((a: { cid?: string }) => !a.cid) && (
                <AttachmentPreview attachments={fullEmail.attachments} emailId={email.id} />
              )}
              <div className="mt-5 flex gap-2 flex-wrap">
                <Button size="sm" variant="outline" className="rounded-full px-4 h-8 text-[#3c4043] border-[#dadce0] hover:bg-[#f1f3f4]" onClick={() => onReply(fullEmail)} data-testid={`thread-reply-${email.id}`}>
                  <Reply className="h-3.5 w-3.5 mr-1.5" />Reply
                </Button>
                <Button size="sm" variant="outline" className="rounded-full px-4 h-8 text-[#3c4043] border-[#dadce0] hover:bg-[#f1f3f4]" onClick={() => onReplyAll(fullEmail)} data-testid={`thread-replyall-${email.id}`}>
                  <ReplyAll className="h-3.5 w-3.5 mr-1.5" />Reply all
                </Button>
                <Button size="sm" variant="outline" className="rounded-full px-4 h-8 text-[#3c4043] border-[#dadce0] hover:bg-[#f1f3f4]" onClick={() => onForward(fullEmail)} data-testid={`thread-forward-${email.id}`}>
                  <Forward className="h-3.5 w-3.5 mr-1.5" />Forward
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ThreadView({
  emails,
  onBack,
  onArchive,
  onDelete,
  onStar,
  onToggleRead,
  clockFormat,
  onOpenCompose,
}: {
  emails: Email[];
  labels: EmailLabel[];
  showLabels: boolean;
  onBack: () => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onStar: (id: string) => void;
  onToggleRead: (id: string, isUnread: boolean) => void;
  clockFormat: "12h" | "24h";
  onOpenCompose: (defaults: { to?: string; cc?: string; subject?: string; body?: string; inReplyTo?: string; references?: string }) => void;
}) {
  const sorted = useMemo(() =>
    [...emails].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [emails]
  );
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set([sorted[sorted.length - 1]?.id]));

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const threadSubject = sorted[0]?.subject.replace(/^(Re|Fwd?|RE|FW?)(\[\d+\])?:\s*/gi, "").trim() || "(no subject)";

  const escapeHtml = (str: string) => {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  };

  const buildQuotedBody = (em: Email, fullBody: string) => {
    const dateStr = escapeHtml(format(new Date(em.date), "EEE, MMM d, yyyy 'at' h:mm a"));
    const senderStr = `${escapeHtml(em.sender.name)} &lt;${escapeHtml(em.sender.email)}&gt;`;
    const sanitized = DOMPurify.sanitize(fullBody, {
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'button'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
      ALLOW_DATA_ATTR: false,
    });
    return `<br><br><div class="gmail_quote"><div style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex"><p>On ${dateStr}, ${senderStr} wrote:</p>${sanitized}</div></div>`;
  };

  const handleReply = (fullEmail: Email) => {
    const reSubject = fullEmail.subject.startsWith("Re:") ? fullEmail.subject : `Re: ${fullEmail.subject}`;
    onOpenCompose({
      to: fullEmail.sender.email,
      subject: reSubject,
      body: buildQuotedBody(fullEmail, fullEmail.bodyHtml || fullEmail.body),
      inReplyTo: fullEmail.messageId,
    });
  };

  const handleReplyAll = (fullEmail: Email) => {
    const allTo = [fullEmail.sender, ...(fullEmail.to || []), ...(fullEmail.cc || [])]
      .filter((p, i, arr) => arr.findIndex(x => x.email === p.email) === i)
      .map(p => p.email)
      .join(", ");
    const reSubject = fullEmail.subject.startsWith("Re:") ? fullEmail.subject : `Re: ${fullEmail.subject}`;
    onOpenCompose({
      to: allTo,
      subject: reSubject,
      body: buildQuotedBody(fullEmail, fullEmail.bodyHtml || fullEmail.body),
      inReplyTo: fullEmail.messageId,
    });
  };

  const handleForward = (fullEmail: Email) => {
    const dateStr = format(new Date(fullEmail.date), "EEE, MMM d, yyyy 'at' h:mm a");
    const toStr = (fullEmail.to || []).map(t => `${escapeHtml(t.name)} &lt;${escapeHtml(t.email)}&gt;`).join(", ");
    const fwdHeader = `<br><br>---------- Forwarded message ---------<br>From: ${escapeHtml(fullEmail.sender.name)} &lt;${escapeHtml(fullEmail.sender.email)}&gt;<br>Date: ${dateStr}<br>Subject: ${escapeHtml(fullEmail.subject)}<br>To: ${toStr}<br><br>`;
    const fwdSubject = fullEmail.subject.startsWith("Fwd:") ? fullEmail.subject : `Fwd: ${fullEmail.subject}`;
    onOpenCompose({
      subject: fwdSubject,
      body: fwdHeader + (fullEmail.bodyHtml || `<pre>${fullEmail.body}</pre>`),
    });
  };

  return (
    <div className="flex flex-col h-full bg-[#f6f8fc] dark:bg-[#1f2123]">
      {/* Header */}
      <div className="bg-white dark:bg-[#2d2e30] border-b border-[#e0e0e0] dark:border-[#3c4043] px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={onBack}
          className="p-1.5 rounded-full hover:bg-[#f1f3f4] dark:hover:bg-[#3c4043] text-[#5f6368]"
          title="Back"
          data-testid="thread-back-button"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h2 className="text-xl font-normal text-[#202124] dark:text-[#e8eaed] flex-1 truncate">{threadSubject}</h2>
        <span className="text-sm text-[#5f6368] flex-shrink-0">{emails.length} message{emails.length !== 1 ? "s" : ""}</span>
        <div className="flex items-center gap-1 ml-2">
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full hover:bg-[#f1f3f4] transition-colors" title="Archive all" onClick={() => { emails.forEach(e => onArchive(e.id)); onBack(); }} data-testid="thread-archive-all">
            <Archive className="h-[18px] w-[18px] text-[#5f6368]" />
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full hover:bg-[#f1f3f4] transition-colors" title="Delete all" onClick={() => { emails.forEach(e => onDelete(e.id)); onBack(); }} data-testid="thread-delete-all">
            <Trash2 className="h-[18px] w-[18px] text-[#5f6368]" />
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full hover:bg-[#f1f3f4] transition-colors" title="Mark all as read" onClick={() => emails.filter(e => e.isUnread).forEach(e => onToggleRead(e.id, false))} data-testid="thread-mark-read-all">
            <MailOpen className="h-[18px] w-[18px] text-[#5f6368]" />
          </Button>
        </div>
      </div>

      {/* Email cards */}
      <div className="flex-1 overflow-y-auto px-4 lg:px-8 py-4 space-y-2" data-testid="thread-email-list">
        {sorted.map(email => (
          <ThreadEmailCard
            key={email.id}
            email={email}
            expanded={expandedIds.has(email.id)}
            onToggle={() => toggleExpanded(email.id)}
            clockFormat={clockFormat}
            onStar={() => onStar(email.id)}
            onReply={handleReply}
            onReplyAll={handleReplyAll}
            onForward={handleForward}
          />
        ))}
      </div>
    </div>
  );
}

function getAttachmentIcon(contentType: string) {
  if (contentType.startsWith("image/")) return Image;
  if (contentType === "application/pdf") return FileText;
  if (contentType.includes("spreadsheet") || contentType.includes("excel") || contentType.includes("csv")) return FileSpreadsheet;
  if (contentType.includes("zip") || contentType.includes("tar") || contentType.includes("gzip") || contentType.includes("compressed")) return FileArchive;
  return FileIcon;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentPreview({ attachments, emailId }: { attachments: EmailAttachment[]; emailId: string }) {
  const [previewAtt, setPreviewAtt] = useState<EmailAttachment | null>(null);

  const visibleAttachments = attachments.filter(att => !att.cid);
  if (visibleAttachments.length === 0) return null;

  const imageAtts = visibleAttachments.filter(att => att.contentType.startsWith("image/"));
  const pdfAtts = visibleAttachments.filter(att => att.contentType === "application/pdf");
  const otherAtts = visibleAttachments.filter(att => !att.contentType.startsWith("image/") && att.contentType !== "application/pdf");

  return (
    <div className="mt-8 border-t border-[#e0e0e0] dark:border-[#3c4043] pt-6">
      <div className="flex items-center gap-2 mb-3">
        <Paperclip className="h-4 w-4 text-[#5f6368]" />
        <span className="text-sm font-medium text-[#202124] dark:text-[#e8eaed]">
          {visibleAttachments.length} attachment{visibleAttachments.length > 1 ? "s" : ""}
        </span>
      </div>

      {imageAtts.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          {imageAtts.map(att => (
            <div key={att.id} className="relative group cursor-pointer rounded-lg overflow-hidden border border-[#dadce0] dark:border-[#3c4043]" onClick={() => setPreviewAtt(att)} data-testid={`attachment-preview-${att.id}`}>
              <img src={`/api/emails/${emailId}/attachments/${att.id}`} alt={att.filename} className="w-full h-32 object-cover" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                <ZoomIn className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1">
                <div className="text-xs text-white truncate">{att.filename}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {pdfAtts.length > 0 && (
        <div className="space-y-2 mb-3">
          {pdfAtts.map(att => (
            <div key={att.id} className="border border-[#dadce0] dark:border-[#3c4043] rounded-lg overflow-hidden">
              <div className="flex items-center justify-between p-3 bg-[#f6f8fc] dark:bg-[#2d2e30]">
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-red-500" />
                  <div>
                    <div className="text-sm text-[#202124] dark:text-[#e8eaed]">{att.filename}</div>
                    <div className="text-xs text-[#5f6368]">{formatFileSize(att.size)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPreviewAtt(att)} className="p-1.5 rounded hover:bg-[#e8eaed] dark:hover:bg-[#3c4043] text-[#5f6368]" title="Preview"><Eye className="w-4 h-4" /></button>
                  <a href={`/api/emails/${emailId}/attachments/${att.id}`} download={att.filename} className="p-1.5 rounded hover:bg-[#e8eaed] dark:hover:bg-[#3c4043] text-[#5f6368]" title="Download"><Download className="w-4 h-4" /></a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {otherAtts.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {otherAtts.map(att => {
            const Icon = getAttachmentIcon(att.contentType);
            return (
              <a key={att.id} href={`/api/emails/${emailId}/attachments/${att.id}`} download={att.filename} className="flex items-center gap-3 p-3 border border-[#dadce0] dark:border-[#3c4043] rounded-lg hover:bg-[#f6f8fc] dark:hover:bg-[#2d2e30] transition-colors group" data-testid={`attachment-${att.id}`}>
                <Icon className="w-8 h-8 text-[#5f6368]" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[#202124] dark:text-[#e8eaed] truncate">{att.filename}</div>
                  <div className="text-xs text-[#5f6368]">{formatFileSize(att.size)}</div>
                </div>
                <Download className="w-4 h-4 text-[#5f6368] opacity-0 group-hover:opacity-100 transition-opacity" />
              </a>
            );
          })}
        </div>
      )}

      {previewAtt && (
        <Dialog open={true} onOpenChange={() => setPreviewAtt(null)}>
          <DialogContent className="sm:max-w-[90vw] max-h-[90vh] p-0 overflow-hidden" aria-describedby="preview-desc">
            <span id="preview-desc" className="sr-only">Attachment preview</span>
            <div className="flex items-center justify-between p-3 border-b border-[#e0e0e0] dark:border-[#3c4043]">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[#202124] dark:text-[#e8eaed]">{previewAtt.filename}</span>
                <span className="text-xs text-[#5f6368]">{formatFileSize(previewAtt.size)}</span>
              </div>
              <div className="flex items-center gap-1">
                <a href={`/api/emails/${emailId}/attachments/${previewAtt.id}`} download={previewAtt.filename} className="p-2 rounded hover:bg-[#f1f3f4] dark:hover:bg-[#3c4043] text-[#5f6368]" title="Download"><Download className="w-4 h-4" /></a>
                <button onClick={() => setPreviewAtt(null)} className="p-2 rounded hover:bg-[#f1f3f4] dark:hover:bg-[#3c4043] text-[#5f6368]"><X className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="flex items-center justify-center bg-[#202124] min-h-[400px] max-h-[80vh] overflow-auto">
              {previewAtt.contentType.startsWith("image/") ? (
                <img src={`/api/emails/${emailId}/attachments/${previewAtt.id}`} alt={previewAtt.filename} className="max-w-full max-h-[80vh] object-contain" />
              ) : previewAtt.contentType === "application/pdf" ? (
                <iframe src={`/api/emails/${emailId}/attachments/${previewAtt.id}`} className="w-full h-[80vh]" title={previewAtt.filename} />
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function EmailView({
  email,
  labels,
  showLabels,
  activeFolder,
  onBack,
  onArchive,
  onDelete,
  onStar,
  onToggleRead,
  onAddLabel,
  onRemoveLabel,
  onMarkAsSpam,
  onNotSpam,
  onBlockSender,
  onUnsubscribe,
  isUnsubscribing,
  onReply,
  onReplyAll,
  onForward,
  onForwardAsAttachment,
  clockFormat,
  signature,
  sendCancellation,
  defaultSendAccountId,
  replyStyle,
  onPopOutCompose,
}: {
  email: Email;
  labels: EmailLabel[];
  showLabels: boolean;
  activeFolder: string;
  onBack: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onStar: () => void;
  onToggleRead: () => void;
  onAddLabel: (labelId: string) => void;
  onRemoveLabel: (labelId: string) => void;
  onMarkAsSpam: () => void;
  onNotSpam: () => void;
  onBlockSender: () => void;
  onUnsubscribe: () => void;
  isUnsubscribing: boolean;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onForwardAsAttachment: () => void;
  clockFormat: "12h" | "24h";
  signature: string;
  sendCancellation: number;
  defaultSendAccountId: string;
  replyStyle: "popout" | "inline";
  onPopOutCompose: (defaults: {to?: string; cc?: string; subject?: string; body?: string; inReplyTo?: string; references?: string; accountEmail?: string}) => void;
}) {
  const [viewMode, setViewMode] = useState<"html" | "text">("html");
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [inlineReplyMode, setInlineReplyMode] = useState<"reply" | "replyAll" | "forward" | null>(null);
  const [inlineReplyDefaults, setInlineReplyDefaults] = useState<{to?: string; cc?: string; subject?: string; body?: string; inReplyTo?: string; references?: string; accountEmail?: string} | null>(null);
  const [inlineReplyKey, setInlineReplyKey] = useState(0);
  const getLabelById = (id: string) => labels.find(l => l.id === id);

  useEffect(() => {
    const handleClickOutside = () => { setMoreMenuOpen(false); };
    if (moreMenuOpen) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [moreMenuOpen]);

  const fullEmailQuery = useQuery<Email>({
    queryKey: [`/api/emails/${email.id}`],
    enabled: !!email.id,
  });

  const fullEmail = fullEmailQuery.data || email;
  const bodyHtmlContent = fullEmail.bodyHtml || (/<[a-z][\s\S]*>/i.test(fullEmail.body) ? fullEmail.body : "");
  const hasHtml = !!bodyHtmlContent;

  const sanitizedHtml = useMemo(() => {
    if (!bodyHtmlContent) return "";
    let html = bodyHtmlContent;
    if (fullEmail.attachments) {
      for (const att of fullEmail.attachments) {
        if (att.cid) {
          html = html.replace(
            new RegExp(`cid:${att.cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
            `/api/emails/${email.id}/attachments/${att.id}`
          );
        }
      }
    }
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
    const result = DOMPurify.sanitize(html, {
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'button'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
      ADD_ATTR: ['target', 'rel', 'align', 'valign', 'width', 'height', 'bgcolor', 'cellpadding', 'cellspacing', 'border', 'background', 'style'],
      ADD_TAGS: ['img', 'picture', 'source'],
      ALLOW_DATA_ATTR: false,
    });
    DOMPurify.removeHook('afterSanitizeAttributes');
    return result;
  }, [bodyHtmlContent, fullEmail.attachments, email.id]);

  const accountsQuery = useQuery<Pop3Account[]>({ queryKey: ["/api/accounts"] });
  const accounts = accountsQuery.data || [];
  const smtpAccounts = accounts.filter(a => a.smtpHost);

  const sanitizeForCompose = (html: string) => {
    return DOMPurify.sanitize(html, {
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'button'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
      ALLOW_DATA_ATTR: false,
    });
  };

  const escapeHtml = (str: string) => {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  };

  const handlePrint = () => {
    const dateStr = format(new Date(fullEmail.date), "EEE, MMM d, yyyy 'at' h:mm a");
    const senderEmail = fullEmail.sender?.email || fullEmail.from || "";
    const senderName = fullEmail.sender?.name || "";
    const senderDisplay = senderName ? `${senderName} <${senderEmail}>` : senderEmail;
    const toList = (fullEmail.to || []).map((r: {name?: string; email: string}) =>
      r.name ? `${r.name} <${r.email}>` : r.email
    ).join(", ");
    const ccList = (fullEmail.cc || []).map((r: {name?: string; email: string}) =>
      r.name ? `${r.name} <${r.email}>` : r.email
    ).join(", ");
    const bodyHtml = sanitizedHtml
      ? sanitizedHtml
      : `<pre style="white-space:pre-wrap;font-family:inherit;font-size:11pt">${escapeHtml(fullEmail.body || "")}</pre>`;

    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) return;
    win.document.write(`<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="UTF-8">
  <title>${escapeHtml(fullEmail.subject || "(no subject)")}</title>
  <style>
    @page { margin: 2cm; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #000; margin: 0; background: #fff; }
    h1 { font-size: 16pt; font-weight: bold; margin: 0 0 12pt 0; line-height: 1.3; }
    table.meta { border-collapse: collapse; font-size: 10pt; margin-bottom: 0; }
    table.meta td { vertical-align: top; padding: 2pt 0; }
    table.meta td.label { font-weight: bold; width: 52pt; padding-right: 8pt; white-space: nowrap; }
    hr { border: none; border-top: 2px solid #000; margin: 12pt 0 16pt 0; }
    .body { font-size: 11pt; line-height: 1.6; word-break: break-word; }
    .body img { max-width: 100% !important; height: auto !important; }
    .body a { color: #1a0dab; }
    * { box-sizing: border-box; }
  </style>
</head><body>
  <h1>${escapeHtml(fullEmail.subject || "(no subject)")}</h1>
  <table class="meta">
    <tr><td class="label">From:</td><td>${escapeHtml(senderDisplay)}</td></tr>
    <tr><td class="label">To:</td><td>${escapeHtml(toList)}</td></tr>
    ${ccList ? `<tr><td class="label">Cc:</td><td>${escapeHtml(ccList)}</td></tr>` : ""}
    <tr><td class="label">Date:</td><td>${escapeHtml(dateStr)}</td></tr>
  </table>
  <hr>
  <div class="body">${bodyHtml}</div>
</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 300);
  };

  const buildQuotedBody = (em: Email, fullBody: string) => {
    const dateStr = escapeHtml(format(new Date(em.date), "EEE, MMM d, yyyy 'at' h:mm a"));
    const senderStr = `${escapeHtml(em.sender.name)} &lt;${escapeHtml(em.sender.email)}&gt;`;
    const sanitized = sanitizeForCompose(fullBody);
    return `<br><br><div class="gmail_quote"><div style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex"><p>On ${dateStr}, ${senderStr} wrote:</p>${sanitized}</div></div>`;
  };

  const openInlineReply = async (mode: "reply" | "replyAll" | "forward") => {
    try {
      const res = await fetch(`/api/emails/${email.id}`, { credentials: "include" });
      const full = await res.json();
      let defaults: {to?: string; cc?: string; subject?: string; body?: string; inReplyTo?: string; references?: string; accountEmail?: string} = {};

      if (mode === "reply") {
        const quotedBody = buildQuotedBody(email, full.bodyHtml || full.body);
        const reSubject = email.subject.startsWith("Re:") ? email.subject : `Re: ${email.subject}`;
        defaults = {
          to: email.sender.email,
          subject: reSubject,
          body: (signature ? `<br><br>${signature}` : "") + quotedBody,
          inReplyTo: email.messageId,
          references: email.messageId,
          accountEmail: email.accountEmail,
        };
      } else if (mode === "replyAll") {
        const quotedBody = buildQuotedBody(email, full.bodyHtml || full.body);
        const reSubject = email.subject.startsWith("Re:") ? email.subject : `Re: ${email.subject}`;
        const myAccounts = accounts.map(a => a.email.toLowerCase());
        const allTo = [email.sender, ...(email.to || []), ...(email.cc || [])]
          .filter(r => !myAccounts.includes(r.email.toLowerCase()))
          .filter((r, i, arr) => arr.findIndex(x => x.email.toLowerCase() === r.email.toLowerCase()) === i);
        defaults = {
          to: allTo.map(r => r.email).join(", "),
          subject: reSubject,
          body: (signature ? `<br><br>${signature}` : "") + quotedBody,
          inReplyTo: email.messageId,
          references: email.messageId,
          accountEmail: email.accountEmail,
        };
      } else {
        const dateStr = escapeHtml(format(new Date(email.date), "EEE, MMM d, yyyy 'at' h:mm a"));
        const toStr = email.to.map((r: any) => `${escapeHtml(r.name)} &lt;${escapeHtml(r.email)}&gt;`).join(", ");
        const fwdHeader = `<br><br>---------- Forwarded message ---------<br>From: ${escapeHtml(email.sender.name)} &lt;${escapeHtml(email.sender.email)}&gt;<br>Date: ${dateStr}<br>Subject: ${escapeHtml(email.subject)}<br>To: ${toStr}<br><br>`;
        defaults = {
          subject: email.subject.startsWith("Fwd:") ? email.subject : `Fwd: ${email.subject}`,
          body: (signature ? `<br><br>${signature}` : "") + fwdHeader + sanitizeForCompose(full.bodyHtml || full.body),
        };
      }

      if (replyStyle === "popout") {
        onPopOutCompose(defaults);
      } else {
        setInlineReplyDefaults(defaults);
        setInlineReplyMode(mode);
        setInlineReplyKey(k => k + 1);
      }
    } catch {}
  };

  const handlePopOut = (currentState: {to?: string; cc?: string; subject?: string; body?: string; inReplyTo?: string; references?: string; accountEmail?: string}) => {
    setInlineReplyMode(null);
    setInlineReplyDefaults(null);
    onPopOutCompose(currentState);
  };

  const handleInlineClose = () => {
    setInlineReplyMode(null);
    setInlineReplyDefaults(null);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-testid="email-view">
      {/* Toolbar */}
      <div className="h-12 flex items-center px-2 gap-1 border-b border-[#e0e0e0] no-print">
        {activeFolder === "spam" ? (
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full hover:bg-[#f1f3f4] transition-colors" onClick={onNotSpam} title="Not spam" data-testid="button-not-spam">
            <ShieldCheck className="h-[18px] w-[18px] text-[#5f6368]" />
          </Button>
        ) : (
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full hover:bg-[#f1f3f4] transition-colors" onClick={onArchive} title="Archive" data-testid="button-archive">
            <Archive className="h-[18px] w-[18px] text-[#5f6368]" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full hover:bg-[#f1f3f4] transition-colors" onClick={onDelete} title="Delete" data-testid="button-delete">
          <Trash2 className="h-[18px] w-[18px] text-[#5f6368]" />
        </Button>
        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full hover:bg-[#f1f3f4] transition-colors" onClick={onToggleRead} title={email.isUnread ? "Mark as read" : "Mark as unread"} data-testid="button-toggle-read">
          {email.isUnread ? <MailOpen className="h-[18px] w-[18px] text-[#5f6368]" /> : <Mail className="h-[18px] w-[18px] text-[#5f6368]" />}
        </Button>
        <Separator orientation="vertical" className="h-5 mx-1" />

        <LabelPopover email={email} labels={labels} onAddLabel={onAddLabel} onRemoveLabel={onRemoveLabel} />

        <Separator orientation="vertical" className="h-5 mx-1" />
        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full hover:bg-[#f1f3f4] transition-colors" onClick={() => openInlineReply("reply")} title="Reply" data-testid="button-reply">
          <Reply className="h-[18px] w-[18px] text-[#5f6368]" />
        </Button>
        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full hover:bg-[#f1f3f4] transition-colors" onClick={() => openInlineReply("replyAll")} title="Reply all" data-testid="button-reply-all">
          <ReplyAll className="h-[18px] w-[18px] text-[#5f6368]" />
        </Button>
        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full hover:bg-[#f1f3f4] transition-colors" onClick={() => openInlineReply("forward")} title="Forward" data-testid="button-forward">
          <Forward className="h-[18px] w-[18px] text-[#5f6368]" />
        </Button>

        {hasHtml && (
          <>
            <Separator orientation="vertical" className="h-5 mx-1" />
            <button
              onClick={() => setViewMode(viewMode === "html" ? "text" : "html")}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-[#5f6368] hover:bg-[#f1f3f4] transition-colors"
              data-testid="button-toggle-view-mode"
              title={viewMode === "html" ? "View plain text" : "View HTML"}
            >
              {viewMode === "html" ? <Code className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {viewMode === "html" ? "Plain text" : "HTML view"}
            </button>
          </>
        )}

        <div className="relative ml-auto">
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full hover:bg-[#f1f3f4] transition-colors" title="More actions" data-testid="button-more-actions"
            onClick={(e) => { e.stopPropagation(); setMoreMenuOpen(!moreMenuOpen); }}>
            <MoreVertical className="h-[18px] w-[18px] text-[#5f6368]" />
          </Button>
          {moreMenuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-[#dadce0] rounded-lg shadow-lg py-1.5 w-52 z-20" data-testid="more-actions-menu">
              {/* Status */}
              <div className="px-3 pt-0.5 pb-1">
                <span className="text-[10px] font-semibold text-[#9aa0a6] uppercase tracking-wider">Status</span>
              </div>
              <button onClick={() => { onToggleRead(); setMoreMenuOpen(false); }} className="w-full text-left px-3 py-1.5 text-sm text-[#3c4043] hover:bg-[#f1f3f4] flex items-center gap-3" data-testid="menu-toggle-read">
                {email.isUnread ? <MailOpen className="h-4 w-4 flex-shrink-0" /> : <Mail className="h-4 w-4 flex-shrink-0" />}
                {email.isUnread ? "Mark as read" : "Mark as unread"}
              </button>
              <button onClick={() => { onStar(); setMoreMenuOpen(false); }} className="w-full text-left px-3 py-1.5 text-sm text-[#3c4043] hover:bg-[#f1f3f4] flex items-center gap-3" data-testid="menu-toggle-star">
                <Star className="h-4 w-4 flex-shrink-0" />
                {email.isStarred ? "Remove star" : "Add star"}
              </button>

              {/* Organize */}
              <div className="border-t border-[#e0e0e0] my-1" />
              <div className="px-3 pt-0.5 pb-1">
                <span className="text-[10px] font-semibold text-[#9aa0a6] uppercase tracking-wider">Organize</span>
              </div>
              {activeFolder === "spam" ? (
                <button onClick={() => { onNotSpam(); setMoreMenuOpen(false); }} className="w-full text-left px-3 py-1.5 text-sm text-[#3c4043] hover:bg-[#f1f3f4] flex items-center gap-3" data-testid="menu-not-spam">
                  <ShieldCheck className="h-4 w-4 flex-shrink-0" />
                  Not spam
                </button>
              ) : (
                <>
                  <button onClick={() => { onArchive(); setMoreMenuOpen(false); }} className="w-full text-left px-3 py-1.5 text-sm text-[#3c4043] hover:bg-[#f1f3f4] flex items-center gap-3" data-testid="menu-archive">
                    <Archive className="h-4 w-4 flex-shrink-0" />
                    Archive
                  </button>
                  <button onClick={() => { onMarkAsSpam(); setMoreMenuOpen(false); }} className="w-full text-left px-3 py-1.5 text-sm text-[#3c4043] hover:bg-[#f1f3f4] flex items-center gap-3" data-testid="menu-mark-spam">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    Mark as spam
                  </button>
                </>
              )}
              <button onClick={() => { onDelete(); setMoreMenuOpen(false); }} className="w-full text-left px-3 py-1.5 text-sm text-[#3c4043] hover:bg-[#f1f3f4] flex items-center gap-3" data-testid="menu-delete">
                <Trash2 className="h-4 w-4 flex-shrink-0" />
                Delete
              </button>
              <button onClick={() => { onBlockSender(); setMoreMenuOpen(false); }} className="w-full text-left px-3 py-1.5 text-sm text-[#c5221f] hover:bg-[#f1f3f4] flex items-center gap-3" data-testid="menu-block-sender">
                <Ban className="h-4 w-4 flex-shrink-0" />
                Block sender
              </button>

              {/* Export & Share */}
              <div className="border-t border-[#e0e0e0] my-1" />
              <div className="px-3 pt-0.5 pb-1">
                <span className="text-[10px] font-semibold text-[#9aa0a6] uppercase tracking-wider">Export &amp; Share</span>
              </div>
              <button onClick={() => { onForwardAsAttachment(); setMoreMenuOpen(false); }} className="w-full text-left px-3 py-1.5 text-sm text-[#3c4043] hover:bg-[#f1f3f4] flex items-center gap-3" data-testid="menu-forward-attachment">
                <Paperclip className="h-4 w-4 flex-shrink-0" />
                Forward as attachment
              </button>
              <button onClick={() => { window.open(`/api/emails/${email.id}/eml`, "_blank"); setMoreMenuOpen(false); }} className="w-full text-left px-3 py-1.5 text-sm text-[#3c4043] hover:bg-[#f1f3f4] flex items-center gap-3" data-testid="menu-download-eml">
                <Download className="h-4 w-4 flex-shrink-0" />
                Download as .eml
              </button>
              <button onClick={() => { handlePrint(); setMoreMenuOpen(false); }} className="w-full text-left px-3 py-1.5 text-sm text-[#3c4043] hover:bg-[#f1f3f4] flex items-center gap-3" data-testid="menu-print">
                <Printer className="h-4 w-4 flex-shrink-0" />
                Print
              </button>
            </div>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-6 py-6 min-w-0">
          {/* Subject + Labels */}
          <div className="flex items-start gap-2 mb-6">
            <h1 className="text-[22px] font-normal text-[#202124] leading-7 flex-1 break-words">
              {fullEmail.subject}
            </h1>
            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full flex-shrink-0 hover:bg-[#f1f3f4] transition-colors" onClick={onStar} title={email.isStarred ? "Remove star" : "Add star"}>
              <Star className={`h-5 w-5 ${email.isStarred ? "fill-[#f4b400] text-[#f4b400]" : "text-[#c4c7c5]"}`} />
            </Button>
          </div>

          {fullEmail.sendStatus === "sending" && (
            <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-[#fef7e0] border border-[#f5d565] text-sm text-[#b06000]" data-testid="banner-sending">
              <div className="w-3 h-3 border-2 border-[#b06000] border-t-transparent rounded-full animate-spin flex-shrink-0" />
              <span className="flex-1">Sending this email...</span>
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7 border-[#b06000] text-[#b06000] hover:bg-[#b06000] hover:text-white"
                onClick={async () => {
                  try {
                    await apiRequest("POST", `/api/emails/${email.id}/retry-send`);
                    queryClient.invalidateQueries();
                    toast({ title: "Retrying send..." });
                  } catch (err: any) {
                    toast({ title: "Retry failed", description: err.message, variant: "destructive" });
                  }
                }}
                data-testid="button-retry-sending"
              >
                Retry
              </Button>
            </div>
          )}
          {fullEmail.sendStatus === "failed" && (
            <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-[#fce8e6] border border-[#f5c6c2] text-sm text-[#c5221f]" data-testid="banner-send-failed">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1">Failed to send: {fullEmail.sendError || "Unknown error"}</span>
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7 border-[#c5221f] text-[#c5221f] hover:bg-[#c5221f] hover:text-white"
                onClick={async () => {
                  try {
                    await apiRequest("POST", `/api/emails/${email.id}/retry-send`);
                    queryClient.invalidateQueries();
                    toast({ title: "Retrying send..." });
                  } catch (err: any) {
                    toast({ title: "Retry failed", description: err.message, variant: "destructive" });
                  }
                }}
                data-testid="button-retry-send"
              >
                Retry
              </Button>
            </div>
          )}

          {/* Label badges */}
          {showLabels && email.labels && email.labels.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {email.labels.map(lId => {
                const lbl = getLabelById(lId);
                if (!lbl) return null;
                return (
                  <span
                    key={lId}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-xs font-medium"
                    style={{
                      backgroundColor: lbl.color + "18",
                      color: lbl.color,
                      border: `1px solid ${lbl.color}40`,
                    }}
                  >
                    {lbl.name}
                    <button
                      onClick={() => onRemoveLabel(lId)}
                      className="hover:opacity-70"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          {/* Print-only email header — hidden in screen view, visible when printing */}
          <div className="print-email-header" style={{ display: "none" }}>
            <h1>{fullEmail.subject}</h1>
            <table>
              <tbody>
                <tr><td>From:</td><td>{fullEmail.sender.name} &lt;{fullEmail.sender.email}&gt;</td></tr>
                <tr><td>To:</td><td>{fullEmail.to.map(t => `${t.name} <${t.email}>`).join(", ")}</td></tr>
                {fullEmail.cc && fullEmail.cc.length > 0 && (
                  <tr><td>Cc:</td><td>{fullEmail.cc.map(t => `${t.name} <${t.email}>`).join(", ")}</td></tr>
                )}
                <tr><td>Date:</td><td>{format(new Date(fullEmail.date), clockFormat === "24h" ? "PPpp" : "PPpp")}</td></tr>
              </tbody>
            </table>
          </div>

          {/* Sender info */}
          <div className="flex items-start justify-between gap-2 mb-6">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-medium flex-shrink-0" style={{ backgroundColor: "#1a73e8" }}>
                {fullEmail.sender.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-[#202124]">{fullEmail.sender.name}</span>
                  <span className="text-xs text-[#5f6368] truncate">&lt;{fullEmail.sender.email}&gt;</span>
                  {(fullEmail.listUnsubscribeUrl || fullEmail.listUnsubscribeMail) && (
                    <button
                      onClick={onUnsubscribe}
                      disabled={isUnsubscribing}
                      className="text-xs text-[#c5221f] hover:underline disabled:opacity-50 flex-shrink-0"
                      data-testid="button-unsubscribe"
                    >
                      {isUnsubscribing ? "Unsubscribing..." : "Unsubscribe"}
                    </button>
                  )}
                </div>
                <div className="text-xs text-[#5f6368] truncate">
                  to {fullEmail.accountEmail || fullEmail.to.map(t => t.name || t.email).join(", ")}
                </div>
              </div>
            </div>
            <div className="text-xs text-[#5f6368] flex-shrink-0 whitespace-nowrap">
              {format(new Date(fullEmail.date), clockFormat === "24h" ? "MMM d, yyyy, HH:mm" : "MMM d, yyyy, h:mm a")}
            </div>
          </div>

          {/* Email body */}
          <div className="text-sm text-[#202124] leading-relaxed">
            {hasHtml && viewMode === "html" ? (
              <div
                className="email-html-body"
                dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
              />
            ) : (
              <pre className="whitespace-pre-wrap font-sans">{fullEmail.body}</pre>
            )}
          </div>

          {/* Attachments */}
          {fullEmail.attachments && fullEmail.attachments.length > 0 && (
            <AttachmentPreview attachments={fullEmail.attachments} emailId={email.id} />
          )}

          {/* Reply / Forward buttons or Inline Composer */}
          {inlineReplyMode && inlineReplyDefaults ? (
            <InlineReplyComposer
              key={`inline-reply-${inlineReplyKey}`}
              mode={inlineReplyMode}
              defaults={inlineReplyDefaults}
              email={email}
              smtpAccounts={smtpAccounts}
              defaultSendAccountId={defaultSendAccountId}
              sendCancellation={sendCancellation}
              onClose={handleInlineClose}
              onPopOut={handlePopOut}
            />
          ) : (
            <div className="mt-8 flex gap-2 no-print">
              <button onClick={() => openInlineReply("reply")} className="flex items-center gap-2 px-5 py-2.5 border border-[#dadce0] rounded-full text-sm text-[#202124] hover:bg-[#f1f3f4] transition-colors" data-testid="button-reply-bottom">
                <Reply className="h-4 w-4" /> Reply
              </button>
              <button onClick={() => openInlineReply("replyAll")} className="flex items-center gap-2 px-5 py-2.5 border border-[#dadce0] rounded-full text-sm text-[#202124] hover:bg-[#f1f3f4] transition-colors" data-testid="button-reply-all-bottom">
                <ReplyAll className="h-4 w-4" /> Reply all
              </button>
              <button onClick={() => openInlineReply("forward")} className="flex items-center gap-2 px-5 py-2.5 border border-[#dadce0] rounded-full text-sm text-[#202124] hover:bg-[#f1f3f4] transition-colors" data-testid="button-forward-bottom">
                <Forward className="h-4 w-4" /> Forward
              </button>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function InlineReplyComposer({
  mode,
  defaults,
  email,
  smtpAccounts,
  defaultSendAccountId,
  sendCancellation,
  onClose,
  onPopOut,
}: {
  mode: "reply" | "replyAll" | "forward";
  defaults: {to?: string; cc?: string; subject?: string; body?: string; inReplyTo?: string; references?: string; accountEmail?: string};
  email: Email;
  smtpAccounts: Pop3Account[];
  defaultSendAccountId: string;
  sendCancellation: number;
  onClose: () => void;
  onPopOut: (state: {to?: string; cc?: string; subject?: string; body?: string; inReplyTo?: string; references?: string; accountEmail?: string}) => void;
}) {
  const [to, setTo] = useState(defaults.to || "");
  const [cc, setCc] = useState(defaults.cc || "");
  const [bcc, setBcc] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(!!defaults.cc);
  const [subject, setSubject] = useState(defaults.subject || "");
  const [body, setBody] = useState(defaults.body || "");

  const [attachments, setAttachments] = useState<{ name: string; size: number; type: string; dataUrl: string }[]>([]);
  const [showFontMenu, setShowFontMenu] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [contactSuggestions, setContactSuggestions] = useState<{name: string; email: string}[]>([]);
  const [activeContactField, setActiveContactField] = useState<"to" | "cc" | "bcc" | null>(null);
  const [contactQuery, setContactQuery] = useState("");
  const [showQuotedText, setShowQuotedText] = useState(false);
  const contactDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const processFiles = (files: FileList | File[]) => {
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        setAttachments(prev => [...prev, { name: file.name, size: file.size, type: file.type, dataUrl: reader.result as string }]);
      };
      reader.readAsDataURL(file);
    });
  };

  useEffect(() => {
    if (smtpAccounts.length > 0) {
      if (defaultSendAccountId === "__smart__" && defaults.accountEmail) {
        const match = smtpAccounts.find(a => a.email.toLowerCase() === defaults.accountEmail!.toLowerCase());
        setSelectedAccountId(match?.id || "");
      } else {
        const defaultExists = smtpAccounts.some(a => a.id === defaultSendAccountId);
        setSelectedAccountId(defaultExists ? defaultSendAccountId : "");
      }
    }
  }, [smtpAccounts, defaultSendAccountId]);

  useEffect(() => {
    if (editorRef.current && defaults.body) {
      const quoteDiv = defaults.body.indexOf('<div class="gmail_quote">');
      if (quoteDiv > -1) {
        const before = defaults.body.substring(0, quoteDiv);
        editorRef.current.innerHTML = before;
      } else {
        editorRef.current.innerHTML = defaults.body;
      }
    }
    requestAnimationFrame(() => {
      if (editorRef.current) {
        editorRef.current.focus();
        const range = document.createRange();
        range.selectNodeContents(editorRef.current);
        range.collapse(true);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    });
  }, []);

  const syncBody = () => {
    if (editorRef.current) {
      const editorContent = editorRef.current.innerHTML;
      const quoteDiv = defaults.body?.indexOf('<div class="gmail_quote">') ?? -1;
      const quotedPart = quoteDiv > -1 ? defaults.body!.substring(quoteDiv) : "";
      setBody(editorContent + quotedPart);
    }
  };

  const execCommand = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    syncBody();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          setAttachments(prev => [...prev, { name: file.name || "pasted-image.png", size: file.size, type: file.type, dataUrl }]);
        };
        reader.readAsDataURL(file);
        return;
      }
    }
  };

  const handleFileAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(e.target.files);
    e.target.value = "";
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleContactFieldChange = (field: "to" | "cc" | "bcc", value: string) => {
    if (field === "to") setTo(value);
    else if (field === "cc") setCc(value);
    else setBcc(value);
    setActiveContactField(field);
    if (contactDebounceRef.current) clearTimeout(contactDebounceRef.current);
    const parts = value.split(",");
    const lastPart = parts[parts.length - 1].trim();
    if (lastPart.length >= 2) {
      setContactQuery(lastPart);
      contactDebounceRef.current = setTimeout(async () => {
        try {
          const res = await fetch(`/api/contacts?q=${encodeURIComponent(lastPart)}`, { credentials: "include" });
          const data = await res.json();
          setContactSuggestions(data);
        } catch { setContactSuggestions([]); }
      }, 200);
    } else {
      setContactSuggestions([]);
    }
  };

  const selectContact = (contact: {name: string; email: string}) => {
    const field = activeContactField;
    if (!field) return;
    const setter = field === "to" ? setTo : field === "cc" ? setCc : setBcc;
    const current = field === "to" ? to : field === "cc" ? cc : bcc;
    const parts = current.split(",").map(p => p.trim()).filter(Boolean);
    parts.pop();
    parts.push(contact.email);
    setter(parts.join(", ") + ", ");
    setContactSuggestions([]);
  };

  const fireAndForgetSend = (data: any) => {
    fetch("/api/emails/compose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(data),
    }).then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Send failed" }));
        toast({ title: "Send failed", description: err.message, variant: "destructive" });
      }
      queryClient.invalidateQueries();
    }).catch(() => {
      toast({ title: "Send failed", description: "Network error", variant: "destructive" });
    });
  };

  const handleSend = () => {
    if (!to || !subject) return;
    const data: any = {
      accountId: selectedAccountId || undefined,
      to,
      subject,
      body,
      inReplyTo: defaults.inReplyTo || undefined,
      references: defaults.references || undefined,
    };
    if (cc) data.cc = cc;
    if (bcc) data.bcc = bcc;
    if (attachments.length > 0) data.attachments = attachments;

    fireAndForgetSend(data);
    toast({ title: "Message sent" });
    onClose();
  };

  const getCurrentState = () => ({
    to, cc, subject, body,
    inReplyTo: defaults.inReplyTo,
    references: defaults.references,
    accountEmail: defaults.accountEmail,
  });

  const modeLabel = mode === "reply" ? "Reply" : mode === "replyAll" ? "Reply All" : "Forward";
  const ModeIcon = mode === "reply" ? Reply : mode === "replyAll" ? ReplyAll : Forward;

  return (
    <div
      className={`mt-6 border rounded-2xl overflow-hidden no-print relative ${isDragOver ? "border-[#1a73e8] border-2" : "border-[#dadce0]"}`}
      data-testid="inline-reply-composer"
      onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
      onDrop={e => { e.preventDefault(); setIsDragOver(false); if (e.dataTransfer.files.length > 0) processFiles(e.dataTransfer.files); }}
    >
      {isDragOver && (
        <div className="absolute inset-0 z-10 bg-[#e8f0fe]/80 flex items-center justify-center rounded-2xl pointer-events-none">
          <div className="text-[#1a73e8] font-medium text-sm">Drop files to attach</div>
        </div>
      )}
      <div className="flex items-center gap-2 px-4 py-2 bg-[#f6f8fc] border-b border-[#e0e0e0]">
        <ModeIcon className="h-4 w-4 text-[#5f6368]" />
        <span className="text-sm text-[#5f6368] flex-1">
          {mode === "forward" ? "" : `${email.sender.name || email.sender.email}`}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => onPopOut(getCurrentState())}
            className="p-1.5 rounded hover:bg-[#e0e0e0] transition-colors"
            title="Pop out reply"
            data-testid="button-inline-popout"
          >
            <Maximize2 className="h-3.5 w-3.5 text-[#5f6368]" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-[#e0e0e0] transition-colors"
            title="Discard"
            data-testid="button-inline-close"
          >
            <X className="h-3.5 w-3.5 text-[#5f6368]" />
          </button>
        </div>
      </div>

      <div className="bg-white">
        <div className="px-4 space-y-0">
          <div className="flex items-center border-b border-[#e0e0e0] py-1.5">
            <span className="text-sm text-[#5f6368] w-12">From</span>
            {smtpAccounts.length > 0 ? (
              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="flex-1 text-sm outline-none bg-transparent"
                data-testid="select-inline-account"
              >
                <option value="">Select an account...</option>
                {smtpAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name} ({a.email})</option>
                ))}
              </select>
            ) : (
              <span className="flex-1 text-sm text-[#9aa0a6] italic">No accounts configured</span>
            )}
          </div>

          <div className="relative flex items-center border-b border-[#e0e0e0] py-1.5">
            <span className="text-sm text-[#5f6368] w-12">To</span>
            <input
              value={to}
              onChange={(e) => handleContactFieldChange("to", e.target.value)}
              onFocus={() => setActiveContactField("to")}
              onBlur={() => setTimeout(() => { if (activeContactField === "to") setContactSuggestions([]); }, 200)}
              className="flex-1 text-sm outline-none"
              placeholder="Recipients"
              data-testid="input-inline-to"
            />
            {!showCcBcc && (
              <button onClick={() => setShowCcBcc(true)} className="text-xs text-[#5f6368] hover:text-[#202124] ml-2 whitespace-nowrap" data-testid="button-inline-cc-bcc">
                Cc Bcc
              </button>
            )}
            {activeContactField === "to" && contactSuggestions.length > 0 && (
              <div className="absolute left-12 top-full mt-1 bg-white border border-[#dadce0] rounded-lg shadow-lg py-1 w-[360px] z-30 max-h-[320px] overflow-y-auto">
                {contactSuggestions.map((c, i) => (
                  <button key={i} onMouseDown={(e) => { e.preventDefault(); selectContact(c); }} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[#f1f3f4] transition-colors">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0" style={{backgroundColor: ["#1a73e8","#e8710a","#137333","#a142f4","#e52592"][i % 5]}}>{(c.name || c.email).charAt(0).toUpperCase()}</div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-[#202124] truncate">{c.name || c.email}</div>
                      <div className="text-xs text-[#5f6368] truncate">{c.email}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {showCcBcc && (
            <>
              <div className="relative flex items-center border-b border-[#e0e0e0] py-1.5">
                <span className="text-sm text-[#5f6368] w-12">Cc</span>
                <input value={cc} onChange={(e) => handleContactFieldChange("cc", e.target.value)} onFocus={() => setActiveContactField("cc")} onBlur={() => setTimeout(() => { if (activeContactField === "cc") setContactSuggestions([]); }, 200)} className="flex-1 text-sm outline-none" data-testid="input-inline-cc" />
                {activeContactField === "cc" && contactSuggestions.length > 0 && (
                  <div className="absolute left-12 top-full mt-1 bg-white border border-[#dadce0] rounded-lg shadow-lg py-1 w-[360px] z-30 max-h-[320px] overflow-y-auto">
                    {contactSuggestions.map((c, i) => (
                      <button key={i} onMouseDown={(e) => { e.preventDefault(); selectContact(c); }} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[#f1f3f4] transition-colors">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0" style={{backgroundColor: ["#1a73e8","#e8710a","#137333","#a142f4","#e52592"][i % 5]}}>{(c.name || c.email).charAt(0).toUpperCase()}</div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-[#202124] truncate">{c.name || c.email}</div>
                          <div className="text-xs text-[#5f6368] truncate">{c.email}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative flex items-center border-b border-[#e0e0e0] py-1.5">
                <span className="text-sm text-[#5f6368] w-12">Bcc</span>
                <input value={bcc} onChange={(e) => handleContactFieldChange("bcc", e.target.value)} onFocus={() => setActiveContactField("bcc")} onBlur={() => setTimeout(() => { if (activeContactField === "bcc") setContactSuggestions([]); }, 200)} className="flex-1 text-sm outline-none" data-testid="input-inline-bcc" />
                {activeContactField === "bcc" && contactSuggestions.length > 0 && (
                  <div className="absolute left-12 top-full mt-1 bg-white border border-[#dadce0] rounded-lg shadow-lg py-1 w-[360px] z-30 max-h-[320px] overflow-y-auto">
                    {contactSuggestions.map((c, i) => (
                      <button key={i} onMouseDown={(e) => { e.preventDefault(); selectContact(c); }} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[#f1f3f4] transition-colors">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0" style={{backgroundColor: ["#1a73e8","#e8710a","#137333","#a142f4","#e52592"][i % 5]}}>{(c.name || c.email).charAt(0).toUpperCase()}</div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-[#202124] truncate">{c.name || c.email}</div>
                          <div className="text-xs text-[#5f6368] truncate">{c.email}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={syncBody}
          onPaste={handlePaste}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); handleSend(); } }}
          className="px-4 text-sm outline-none py-3 min-h-[120px]"
          style={{ wordBreak: "break-word" }}
          data-testid="input-inline-body"
        />

        {defaults.body && defaults.body.includes('gmail_quote') && (
          <div className="px-4 pb-2">
            <button
              onClick={() => setShowQuotedText(!showQuotedText)}
              className="text-xs text-[#5f6368] border border-[#dadce0] rounded px-2 py-0.5 hover:bg-[#f1f3f4] transition-colors"
              data-testid="button-toggle-quoted"
            >
              ···
            </button>
            {showQuotedText && (
              <div
                className="mt-2 text-sm text-[#5f6368]"
                dangerouslySetInnerHTML={{ __html: defaults.body.substring(defaults.body.indexOf('<div class="gmail_quote">')) }}
              />
            )}
          </div>
        )}

        {attachments.length > 0 && (
          <div className="px-4 py-1 border-t border-[#e0e0e0]">
            <div className="flex flex-wrap gap-1.5">
              {attachments.map((att, i) => (
                <div key={i} className="flex items-center gap-1.5 bg-[#f1f3f4] rounded px-2 py-1 text-xs text-[#3c4043]">
                  <Paperclip className="h-3 w-3 text-[#5f6368]" />
                  <span className="truncate max-w-[150px]">{att.name}</span>
                  <span className="text-[#80868b]">({formatFileSize(att.size)})</span>
                  <button onClick={() => removeAttachment(i)} className="text-[#5f6368] hover:text-[#202124]">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="px-4 py-2 flex items-center justify-between border-t border-[#e0e0e0] bg-white">
        <div className="flex items-center gap-1">
          <Button
            onClick={handleSend}
            disabled={!to || !subject}
            className="rounded-full px-6 h-9"
            style={{ backgroundColor: "#0b57d0" }}
            data-testid="button-inline-send"
          >
            Send
          </Button>

          <div className="h-5 w-px bg-[#dadce0] mx-1" />

          <div className="relative">
            <button onClick={() => setShowFontMenu(!showFontMenu)} className="p-1.5 rounded hover:bg-[#f1f3f4] text-[#5f6368]" title="Font options" data-testid="button-inline-font">
              <Type className="h-4 w-4" />
            </button>
            {showFontMenu && (
              <div className="absolute bottom-full left-0 mb-1 bg-white border border-[#dadce0] rounded-lg shadow-lg p-2 w-[220px] z-10">
                <div className="text-xs text-[#5f6368] mb-1 px-1">Font family</div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {["Arial", "Georgia", "Courier New", "Verdana", "Times New Roman"].map(font => (
                    <button key={font} onClick={() => { execCommand("fontName", font); setShowFontMenu(false); }} className="text-xs px-2 py-1 rounded hover:bg-[#f1f3f4] text-[#3c4043]" style={{ fontFamily: font }}>
                      {font}
                    </button>
                  ))}
                </div>
                <div className="text-xs text-[#5f6368] mb-1 px-1">Font size</div>
                <div className="flex gap-1">
                  {[{ label: "Small", val: "2" }, { label: "Normal", val: "3" }, { label: "Large", val: "5" }, { label: "Huge", val: "7" }].map(s => (
                    <button key={s.label} onClick={() => { execCommand("fontSize", s.val); setShowFontMenu(false); }} className="text-xs px-2 py-1 rounded hover:bg-[#f1f3f4] text-[#3c4043]">
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button onClick={() => execCommand("bold")} className="p-1.5 rounded hover:bg-[#f1f3f4] text-[#5f6368]" title="Bold"><Bold className="h-4 w-4" /></button>
          <button onClick={() => execCommand("italic")} className="p-1.5 rounded hover:bg-[#f1f3f4] text-[#5f6368]" title="Italic"><Italic className="h-4 w-4" /></button>
          <button onClick={() => execCommand("underline")} className="p-1.5 rounded hover:bg-[#f1f3f4] text-[#5f6368]" title="Underline"><Underline className="h-4 w-4" /></button>

          <div className="h-5 w-px bg-[#dadce0] mx-1" />

          <button onClick={() => execCommand("insertUnorderedList")} className="p-1.5 rounded hover:bg-[#f1f3f4] text-[#5f6368]" title="Bullet list"><List className="h-4 w-4" /></button>
          <button onClick={() => execCommand("insertOrderedList")} className="p-1.5 rounded hover:bg-[#f1f3f4] text-[#5f6368]" title="Numbered list"><ListOrdered className="h-4 w-4" /></button>

          <div className="h-5 w-px bg-[#dadce0] mx-1" />

          <button onClick={() => { const url = prompt("Enter URL:"); if (url) execCommand("createLink", url); }} className="p-1.5 rounded hover:bg-[#f1f3f4] text-[#5f6368]" title="Insert link">
            <LinkIcon className="h-4 w-4" />
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="p-1.5 rounded hover:bg-[#f1f3f4] text-[#5f6368]" title="Attach file">
            <Paperclip className="h-4 w-4" />
          </button>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileAttach} />
        </div>

        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-[#f1f3f4] transition-colors" onClick={onClose} data-testid="button-inline-discard">
          <Trash2 className="h-4 w-4 text-[#5f6368]" />
        </Button>
      </div>
    </div>
  );
}

function LabelPopover({
  email,
  labels,
  onAddLabel,
  onRemoveLabel,
}: {
  email: Email;
  labels: EmailLabel[];
  onAddLabel: (labelId: string) => void;
  onRemoveLabel: (labelId: string) => void;
}) {
  const currentLabels = email.labels || [];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full hover:bg-[#f1f3f4] transition-colors" data-testid="button-label">
          <Tag className="h-[18px] w-[18px] text-[#5f6368]" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-1" align="start">
        <div className="text-xs font-medium text-[#5f6368] px-2 py-1.5">Label as:</div>
        {labels.map(label => {
          const isApplied = currentLabels.includes(label.id);
          return (
            <button
              key={label.id}
              onClick={() => isApplied ? onRemoveLabel(label.id) : onAddLabel(label.id)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-[#f1f3f4] rounded transition-colors"
              data-testid={`label-option-${label.id}`}
            >
              <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: label.color }} />
              <span className="flex-1 text-left truncate">{label.name}</span>
              {isApplied && <Check className="h-3.5 w-3.5 text-[#0b57d0]" />}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

function CreateLabelButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/labels", { name, color: "#1a73e8" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labels"] });
      setName(""); setOpen(false);
      toast({ title: "Label created" });
    },
    onError: (err: Error) => toast({ title: "Failed to create label", description: err.message, variant: "destructive" }),
  });

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-4 pl-6 pr-3 h-8 text-sm rounded-r-full text-[#444746] hover:bg-[#e8eaed]/60"
        data-testid="button-create-label"
      >
        <Plus className="w-[18px] h-[18px]" />
        <span>Create new label</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[340px]" aria-describedby="create-label-desc">
          <span id="create-label-desc" className="sr-only">Create a new label to organize your emails</span>
          <DialogHeader>
            <DialogTitle>New label</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input
              placeholder="Label name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-new-label-name"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!name || createMutation.isPending}
              style={{ backgroundColor: "#0b57d0" }}
              data-testid="button-create-label-submit"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ComposePanel({ open, onClose, signature, sendCancellation, defaultSendAccountId, defaults }: {
  open: boolean; onClose: () => void;
  signature: string;
  sendCancellation: number;
  defaultSendAccountId: string;
  defaults?: {to?: string; cc?: string; subject?: string; body?: string; inReplyTo?: string; references?: string; accountEmail?: string} | null;
}) {
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState(signature ? `<br><br>${signature}` : "");

  const [expanded, setExpanded] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<{ name: string; size: number; type: string; dataUrl: string }[]>([]);
  const [showFontMenu, setShowFontMenu] = useState(false);
  const [inReplyTo, setInReplyTo] = useState<string | undefined>();
  const [references, setReferences] = useState<string | undefined>();
  const [contactSuggestions, setContactSuggestions] = useState<{name: string; email: string}[]>([]);
  const [activeContactField, setActiveContactField] = useState<"to" | "cc" | "bcc" | null>(null);
  const [contactQuery, setContactQuery] = useState("");
  const contactDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const draftIdRef = useRef<string | null>(null);
  const userHasEditedRef = useRef(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const processFiles = (files: FileList | File[]) => {
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        setAttachments(prev => [...prev, { name: file.name, size: file.size, type: file.type, dataUrl }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const defaultsAppliedRef = useRef(false);
  useEffect(() => {
    if (open && defaults && !defaultsAppliedRef.current) {
      defaultsAppliedRef.current = true;
      if (defaults.to) setTo(defaults.to);
      if (defaults.cc) { setCc(defaults.cc); setShowCcBcc(true); }
      if (defaults.subject) setSubject(defaults.subject);
      if (defaults.body) {
        setBody(defaults.body);
        if (editorRef.current) editorRef.current.innerHTML = defaults.body;
      }
      if (defaults.inReplyTo) setInReplyTo(defaults.inReplyTo);
      if (defaults.references) setReferences(defaults.references);
    }
    if (!open) {
      defaultsAppliedRef.current = false;
      userHasEditedRef.current = false;
    }
  }, [open, defaults]);

  useEffect(() => {
    if (open && defaults?.to) {
      requestAnimationFrame(() => {
        if (editorRef.current) {
          editorRef.current.focus();
          const range = document.createRange();
          range.selectNodeContents(editorRef.current);
          range.collapse(true);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      });
    }
  }, [open]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) {
        setAttachments(prev => [...prev, detail]);
      }
    };
    window.addEventListener("add-attachment", handler);
    return () => window.removeEventListener("add-attachment", handler);
  }, []);

  const accountsQuery = useQuery<Pop3Account[]>({
    queryKey: ["/api/accounts"],
  });
  const accounts = accountsQuery.data || [];
  const smtpAccounts = accounts.filter(a => a.smtpHost);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");

  useEffect(() => {
    if (open && !initialized && smtpAccounts.length > 0) {
      if (defaultSendAccountId === "__smart__" && defaults?.accountEmail) {
        const match = smtpAccounts.find(a => a.email.toLowerCase() === defaults.accountEmail!.toLowerCase());
        setSelectedAccountId(match?.id || "");
      } else {
        const defaultExists = smtpAccounts.some(a => a.id === defaultSendAccountId);
        setSelectedAccountId(defaultExists ? defaultSendAccountId : "");
      }
      setInitialized(true);
    }
    if (!open) {
      setInitialized(false);
    }
  }, [open, initialized, smtpAccounts, defaultSendAccountId]);

  useEffect(() => { draftIdRef.current = draftId; }, [draftId]);

  useEffect(() => {
    if (open && editorRef.current) {
      const initialContent = signature ? `<br><br>${signature}` : "";
      if (!editorRef.current.innerHTML || editorRef.current.innerHTML === "<br>") {
        editorRef.current.innerHTML = initialContent;
      }
    }
  }, [open, signature]);

  const hasContent = to || subject || (body && body !== `<br><br>${signature}` && body.replace(/<[^>]*>/g, "").trim() !== signature.trim() && body.replace(/<[^>]*>/g, "").trim() !== "");

  const saveDraft = useCallback(async () => {
    if (!hasContent || savingRef.current) return;
    savingRef.current = true;
    const draftData = { to, cc: cc || undefined, bcc: bcc || undefined, subject, body, accountId: selectedAccountId || undefined };
    try {
      const currentDraftId = draftIdRef.current;
      if (currentDraftId) {
        await apiRequest("PUT", `/api/drafts/${currentDraftId}`, draftData);
      } else {
        const res = await apiRequest("POST", "/api/drafts", draftData);
        const saved = await res.json();
        setDraftId(saved.id);
        draftIdRef.current = saved.id;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/emails?folder=drafts"] });
    } catch {} finally {
      savingRef.current = false;
    }
  }, [to, cc, bcc, subject, body, selectedAccountId, hasContent, queryClient]);

  useEffect(() => {
    if (!open || !hasContent || !userHasEditedRef.current) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      saveDraft();
    }, 2000);
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); };
  }, [to, cc, bcc, subject, body, selectedAccountId, open, hasContent, saveDraft]);

  const deleteDraft = async () => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    const id = draftIdRef.current;
    if (id) {
      try {
        await apiRequest("DELETE", `/api/drafts/${id}`);
        queryClient.invalidateQueries({ queryKey: ["/api/emails?folder=drafts"] });
      } catch {}
    }
  };

  const resetForm = () => {
    setTo(""); setCc(""); setBcc(""); setShowCcBcc(false);
    setSubject(""); setBody(signature ? `<br><br>${signature}` : "");
    setAttachments([]); setShowFontMenu(false);
    setDraftId(null); draftIdRef.current = null; setExpanded(false);
    setInReplyTo(undefined); setReferences(undefined);
    setContactSuggestions([]); setActiveContactField(null); setContactQuery("");
    if (editorRef.current) editorRef.current.innerHTML = signature ? `<br><br>${signature}` : "";
  };

  const searchContacts = (query: string) => {
    if (contactDebounceRef.current) clearTimeout(contactDebounceRef.current);
    if (!query || query.length < 1) {
      setContactSuggestions([]);
      return;
    }
    contactDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/contacts?q=${encodeURIComponent(query)}`, { credentials: "include" });
        const data = await res.json();
        setContactSuggestions(data.slice(0, 8));
      } catch {
        setContactSuggestions([]);
      }
    }, 150);
  };

  const handleContactFieldChange = (field: "to" | "cc" | "bcc", value: string) => {
    userHasEditedRef.current = true;
    if (field === "to") setTo(value);
    else if (field === "cc") setCc(value);
    else setBcc(value);
    const parts = value.split(",");
    const lastPart = parts[parts.length - 1].trim();
    setActiveContactField(field);
    setContactQuery(lastPart);
    searchContacts(lastPart);
  };

  const selectContact = (contact: {name: string; email: string}) => {
    const field = activeContactField;
    if (!field) return;
    const getter = field === "to" ? to : field === "cc" ? cc : bcc;
    const setter = field === "to" ? setTo : field === "cc" ? setCc : setBcc;
    const parts = getter.split(",").map(s => s.trim()).filter(Boolean);
    parts.pop();
    parts.push(contact.email);
    setter(parts.join(", ") + ", ");
    setContactSuggestions([]);
    setActiveContactField(null);
  };

  const execCommand = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    syncBody();
  };

  const syncBody = () => {
    if (editorRef.current) {
      setBody(editorRef.current.innerHTML);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const dataUrl = ev.target?.result as string;
          if (editorRef.current) {
            const img = document.createElement("img");
            img.src = dataUrl;
            img.style.maxWidth = "100%";
            img.style.borderRadius = "4px";
            img.style.margin = "4px 0";
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
              const range = sel.getRangeAt(0);
              range.deleteContents();
              range.insertNode(img);
              range.setStartAfter(img);
              range.collapse(true);
              sel.removeAllRanges();
              sel.addRange(range);
            } else {
              editorRef.current.appendChild(img);
            }
            syncBody();
          }
        };
        reader.readAsDataURL(file);
        return;
      }
    }
  };

  const handleFileAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(e.target.files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const fireAndForgetSend = () => {
    const payload = {
      to, cc: cc || undefined, bcc: bcc || undefined, subject, body,
      accountId: selectedAccountId || undefined,
      inReplyTo: inReplyTo || undefined,
      references: references || undefined,
      attachments: attachments.length > 0 ? attachments.map(a => ({ name: a.name, size: a.size, type: a.type, dataUrl: a.dataUrl })) : undefined,
    };
    fetch("/api/emails/compose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    }).then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Send failed" }));
        toast({ title: "Send failed", description: err.message, variant: "destructive" });
      }
      queryClient.invalidateQueries();
    }).catch(() => {
      toast({ title: "Send failed", description: "Network error", variant: "destructive" });
    });
  };

  const handleSend = () => {
    const draftToDelete = draftIdRef.current;
    const cleanupDraft = () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      if (draftToDelete) {
        fetch(`/api/drafts/${draftToDelete}`, { method: "DELETE", credentials: "include" }).catch(() => {});
      }
    };

    fireAndForgetSend();
    cleanupDraft();
    toast({ title: "Message sent" });
    resetForm();
    onClose();
  };

  const handleClose = async () => {
    if (hasContent) {
      await saveDraft();
      toast({ title: "Draft saved" });
    }
    resetForm();
    onClose();
  };

  const handleDiscard = async () => {
    await deleteDraft();
    resetForm();
    onClose();
  };

  if (!open) return null;

  const panelClasses = expanded
    ? "fixed inset-4 z-50 flex flex-col bg-white rounded-xl shadow-2xl border border-[#dadce0]"
    : "fixed bottom-0 right-6 z-50 flex flex-col bg-white rounded-t-xl shadow-2xl border border-[#dadce0] w-[850px] h-[648px]";

  return (
    <div
      className={`${panelClasses} relative`}
      data-testid="compose-panel"
      onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
      onDrop={e => { e.preventDefault(); setIsDragOver(false); if (e.dataTransfer.files.length > 0) processFiles(e.dataTransfer.files); }}
    >
      {isDragOver && (
        <div className="absolute inset-0 z-10 bg-[#e8f0fe]/80 flex items-center justify-center rounded-xl pointer-events-none border-2 border-[#1a73e8]">
          <div className="text-[#1a73e8] font-medium text-sm">Drop files to attach</div>
        </div>
      )}
      <div className="px-3 py-2 bg-[#404040] text-white rounded-t-xl flex items-center justify-between cursor-default select-none">
        <h3 className="text-sm font-medium truncate">{subject || "New Message"}</h3>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded hover:bg-white/20 transition-colors"
            data-testid="button-compose-expand"
          >
            {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={handleClose}
            className="p-1.5 rounded hover:bg-white/20 transition-colors"
            data-testid="button-compose-close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-y-auto min-h-0">
        <div className="px-3 space-y-0">
          <div className="flex items-center border-b border-[#e0e0e0] py-1.5">
            <span className="text-sm text-[#5f6368] w-12">From</span>
            {smtpAccounts.length > 0 ? (
              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="flex-1 text-sm outline-none bg-transparent"
                data-testid="select-compose-account"
              >
                <option value="">Select an account...</option>
                {smtpAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name} ({a.email})</option>
                ))}
              </select>
            ) : (
              <span className="flex-1 text-sm text-[#9aa0a6] italic" data-testid="text-no-accounts">No accounts configured</span>
            )}
          </div>

          <div className="relative flex items-center border-b border-[#e0e0e0] py-1.5">
            <span className="text-sm text-[#5f6368] w-12">To</span>
            <input
              value={to}
              onChange={(e) => handleContactFieldChange("to", e.target.value)}
              onFocus={() => setActiveContactField("to")}
              onBlur={() => setTimeout(() => { if (activeContactField === "to") setContactSuggestions([]); }, 200)}
              className="flex-1 text-sm outline-none"
              placeholder="Recipients"
              autoFocus={!defaults?.to}
              data-testid="input-compose-to"
            />
            {!showCcBcc && (
              <button
                onClick={() => setShowCcBcc(true)}
                className="text-xs text-[#5f6368] hover:text-[#202124] ml-2 whitespace-nowrap"
                data-testid="button-show-cc-bcc"
              >
                Cc Bcc
              </button>
            )}
            {activeContactField === "to" && contactSuggestions.length > 0 && (
              <div className="absolute left-12 top-full mt-1 bg-white border border-[#dadce0] rounded-lg shadow-lg py-1 w-[360px] z-30 max-h-[320px] overflow-y-auto" data-testid="contact-suggestions-to">
                {contactSuggestions.map((c, i) => (
                  <button key={i} onMouseDown={(e) => { e.preventDefault(); selectContact(c); }} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[#f1f3f4] transition-colors" data-testid={`contact-suggestion-${i}`}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0" style={{backgroundColor: ["#1a73e8","#e8710a","#137333","#a142f4","#e52592"][i % 5]}}>{(c.name || c.email).charAt(0).toUpperCase()}</div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-[#202124] truncate">{c.name || c.email}</div>
                      <div className="text-xs text-[#5f6368] truncate">{c.email}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {showCcBcc && (
            <>
              <div className="relative flex items-center border-b border-[#e0e0e0] py-1.5">
                <span className="text-sm text-[#5f6368] w-12">Cc</span>
                <input
                  value={cc}
                  onChange={(e) => handleContactFieldChange("cc", e.target.value)}
                  onFocus={() => setActiveContactField("cc")}
                  onBlur={() => setTimeout(() => { if (activeContactField === "cc") setContactSuggestions([]); }, 200)}
                  className="flex-1 text-sm outline-none"
                  placeholder=""
                  data-testid="input-compose-cc"
                />
                {activeContactField === "cc" && contactSuggestions.length > 0 && (
                  <div className="absolute left-12 top-full mt-1 bg-white border border-[#dadce0] rounded-lg shadow-lg py-1 w-[360px] z-30 max-h-[320px] overflow-y-auto" data-testid="contact-suggestions-cc">
                    {contactSuggestions.map((c, i) => (
                      <button key={i} onMouseDown={(e) => { e.preventDefault(); selectContact(c); }} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[#f1f3f4] transition-colors">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0" style={{backgroundColor: ["#1a73e8","#e8710a","#137333","#a142f4","#e52592"][i % 5]}}>{(c.name || c.email).charAt(0).toUpperCase()}</div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-[#202124] truncate">{c.name || c.email}</div>
                          <div className="text-xs text-[#5f6368] truncate">{c.email}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative flex items-center border-b border-[#e0e0e0] py-1.5">
                <span className="text-sm text-[#5f6368] w-12">Bcc</span>
                <input
                  value={bcc}
                  onChange={(e) => handleContactFieldChange("bcc", e.target.value)}
                  onFocus={() => setActiveContactField("bcc")}
                  onBlur={() => setTimeout(() => { if (activeContactField === "bcc") setContactSuggestions([]); }, 200)}
                  className="flex-1 text-sm outline-none"
                  placeholder=""
                  data-testid="input-compose-bcc"
                />
                {activeContactField === "bcc" && contactSuggestions.length > 0 && (
                  <div className="absolute left-12 top-full mt-1 bg-white border border-[#dadce0] rounded-lg shadow-lg py-1 w-[360px] z-30 max-h-[320px] overflow-y-auto" data-testid="contact-suggestions-bcc">
                    {contactSuggestions.map((c, i) => (
                      <button key={i} onMouseDown={(e) => { e.preventDefault(); selectContact(c); }} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[#f1f3f4] transition-colors">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0" style={{backgroundColor: ["#1a73e8","#e8710a","#137333","#a142f4","#e52592"][i % 5]}}>{(c.name || c.email).charAt(0).toUpperCase()}</div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-[#202124] truncate">{c.name || c.email}</div>
                          <div className="text-xs text-[#5f6368] truncate">{c.email}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          <div className="flex items-center border-b border-[#e0e0e0] py-1.5">
            <input
              value={subject}
              onChange={(e) => { userHasEditedRef.current = true; setSubject(e.target.value); }}
              className="flex-1 text-sm outline-none"
              placeholder="Subject"
              data-testid="input-compose-subject"
            />
          </div>
        </div>

        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={() => { userHasEditedRef.current = true; syncBody(); }}
          onPaste={handlePaste}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); handleSend(); } }}
          className="flex-1 px-3 text-sm outline-none py-2 overflow-y-auto min-h-[80px]"
          style={{ wordBreak: "break-word" }}
          data-testid="input-compose-body"
        />

        {attachments.length > 0 && (
          <div className="px-3 py-1 border-t border-[#e0e0e0]">
            <div className="flex flex-wrap gap-1.5">
              {attachments.map((att, i) => (
                <div key={i} className="flex items-center gap-1.5 bg-[#f1f3f4] rounded px-2 py-1 text-xs text-[#3c4043]">
                  <Paperclip className="h-3 w-3 text-[#5f6368]" />
                  <span className="truncate max-w-[150px]">{att.name}</span>
                  <span className="text-[#80868b]">({formatFileSize(att.size)})</span>
                  <button onClick={() => removeAttachment(i)} className="text-[#5f6368] hover:text-[#202124]" data-testid={`button-remove-attachment-${i}`}>
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="px-3 py-2 flex items-center justify-between border-t border-[#e0e0e0]">
        <div className="flex items-center gap-1">
          <Button
            onClick={handleSend}
            disabled={!to || !subject}
            className="rounded-full px-6 h-9"
            style={{ backgroundColor: "#0b57d0" }}
            data-testid="button-send"
          >
            Send
          </Button>

          <div className="h-5 w-px bg-[#dadce0] mx-1" />

          <div className="relative">
            <button
              onClick={() => setShowFontMenu(!showFontMenu)}
              className="p-1.5 rounded hover:bg-[#f1f3f4] text-[#5f6368]"
              title="Font options"
              data-testid="button-font-options"
            >
              <Type className="h-4 w-4" />
            </button>
            {showFontMenu && (
              <div className="absolute bottom-full left-0 mb-1 bg-white border border-[#dadce0] rounded-lg shadow-lg p-2 w-[220px] z-10" data-testid="font-menu">
                <div className="text-xs text-[#5f6368] mb-1 px-1">Font family</div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {["Arial", "Georgia", "Courier New", "Verdana", "Times New Roman"].map(font => (
                    <button
                      key={font}
                      onClick={() => { execCommand("fontName", font); setShowFontMenu(false); }}
                      className="text-xs px-2 py-1 rounded hover:bg-[#f1f3f4] text-[#3c4043]"
                      style={{ fontFamily: font }}
                      data-testid={`button-font-${font.toLowerCase().replace(/\s/g, "-")}`}
                    >
                      {font}
                    </button>
                  ))}
                </div>
                <div className="text-xs text-[#5f6368] mb-1 px-1">Font size</div>
                <div className="flex gap-1">
                  {[{ label: "Small", val: "2" }, { label: "Normal", val: "3" }, { label: "Large", val: "5" }, { label: "Huge", val: "7" }].map(s => (
                    <button
                      key={s.label}
                      onClick={() => { execCommand("fontSize", s.val); setShowFontMenu(false); }}
                      className="text-xs px-2 py-1 rounded hover:bg-[#f1f3f4] text-[#3c4043]"
                      data-testid={`button-fontsize-${s.label.toLowerCase()}`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button onClick={() => execCommand("bold")} className="p-1.5 rounded hover:bg-[#f1f3f4] text-[#5f6368]" title="Bold" data-testid="button-bold">
            <Bold className="h-4 w-4" />
          </button>
          <button onClick={() => execCommand("italic")} className="p-1.5 rounded hover:bg-[#f1f3f4] text-[#5f6368]" title="Italic" data-testid="button-italic">
            <Italic className="h-4 w-4" />
          </button>
          <button onClick={() => execCommand("underline")} className="p-1.5 rounded hover:bg-[#f1f3f4] text-[#5f6368]" title="Underline" data-testid="button-underline">
            <Underline className="h-4 w-4" />
          </button>

          <div className="h-5 w-px bg-[#dadce0] mx-1" />

          <button onClick={() => execCommand("insertUnorderedList")} className="p-1.5 rounded hover:bg-[#f1f3f4] text-[#5f6368]" title="Bullet list" data-testid="button-bullet-list">
            <List className="h-4 w-4" />
          </button>
          <button onClick={() => execCommand("insertOrderedList")} className="p-1.5 rounded hover:bg-[#f1f3f4] text-[#5f6368]" title="Numbered list" data-testid="button-numbered-list">
            <ListOrdered className="h-4 w-4" />
          </button>

          <div className="h-5 w-px bg-[#dadce0] mx-1" />

          <button
            onClick={() => {
              const url = prompt("Enter URL:");
              if (url) execCommand("createLink", url);
            }}
            className="p-1.5 rounded hover:bg-[#f1f3f4] text-[#5f6368]"
            title="Insert link"
            data-testid="button-insert-link"
          >
            <LinkIcon className="h-4 w-4" />
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-1.5 rounded hover:bg-[#f1f3f4] text-[#5f6368]"
            title="Attach file"
            data-testid="button-attach-file"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileAttach}
            data-testid="input-file-attachment"
          />
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full"
          onClick={handleDiscard}
          data-testid="button-discard-draft"
        >
          <Trash2 className="h-4 w-4 text-[#5f6368]" />
        </Button>
      </div>
    </div>
  );
}

type LogEntry = { timestamp: string; level: "info" | "warn" | "error" | "success"; source: string; message: string };

function LogsPanel() {
  const queryClient = useQueryClient();
  const [logSearch, setLogSearch] = useState("");
  const [logLevelFilter, setLogLevelFilter] = useState<string>("all");
  const [logSourceFilter, setLogSourceFilter] = useState<string>("all");

  const queryParams = new URLSearchParams();
  if (logLevelFilter !== "all") queryParams.set("level", logLevelFilter);
  if (logSourceFilter !== "all") queryParams.set("source", logSourceFilter);
  if (logSearch) queryParams.set("search", logSearch);
  const queryString = queryParams.toString();

  const { data: logs = [], isLoading, isError, refetch } = useQuery<LogEntry[]>({
    queryKey: ["logs", queryString],
    queryFn: () => apiRequest("GET", `/api/logs${queryString ? `?${queryString}` : ""}`).then(r => r.json()),
    refetchInterval: 5000,
  });

  const { data: allLogs = [] } = useQuery<LogEntry[]>({
    queryKey: ["logs", ""],
    queryFn: () => apiRequest("GET", "/api/logs").then(r => r.json()),
    refetchInterval: 10000,
  });

  const sources = useMemo(() => {
    const s = new Set(allLogs.map(l => l.source));
    return Array.from(s).sort();
  }, [allLogs]);

  const clearMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/logs"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["logs"] }),
  });

  const logEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  useEffect(() => {
    if (autoScroll) logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length, autoScroll]);

  const levelColor = (level: LogEntry["level"]) => {
    switch (level) {
      case "error": return "text-red-400";
      case "warn": return "text-yellow-400";
      case "success": return "text-green-400";
      default: return "text-gray-400";
    }
  };

  const levelBadge = (level: LogEntry["level"]) => {
    switch (level) {
      case "error": return "ERR";
      case "warn": return "WRN";
      case "success": return "OK ";
      default: return "INF";
    }
  };

  const errorCount = allLogs.filter(l => l.level === "error").length;
  const warnCount = allLogs.filter(l => l.level === "warn").length;

  return (
    <div className="p-6 flex flex-col h-full" data-testid="panel-logs">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-base font-medium text-[#202124]">Activity Logs</h3>
          <p className="text-xs text-[#5f6368] mt-1">
            {allLogs.length} total entries
            {errorCount > 0 && <span className="text-red-500 ml-2">{errorCount} error{errorCount !== 1 ? "s" : ""}</span>}
            {warnCount > 0 && <span className="text-yellow-600 ml-2">{warnCount} warning{warnCount !== 1 ? "s" : ""}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => clearMutation.mutate()}
            disabled={allLogs.length === 0}
            data-testid="button-clear-logs"
          >
            Clear
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#5f6368]" />
          <input
            type="text"
            value={logSearch}
            onChange={(e) => setLogSearch(e.target.value)}
            placeholder="Search logs..."
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-[#dadce0] rounded-lg bg-white focus:outline-none focus:border-[#0b57d0] focus:ring-1 focus:ring-[#0b57d0]"
            data-testid="input-log-search"
          />
          {logSearch && (
            <button onClick={() => setLogSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#5f6368] hover:text-[#202124]">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <select
          value={logLevelFilter}
          onChange={(e) => setLogLevelFilter(e.target.value)}
          className="text-xs border border-[#dadce0] rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-[#0b57d0]"
          data-testid="select-log-level"
        >
          <option value="all">All levels</option>
          <option value="error">Errors only</option>
          <option value="warn">Warnings only</option>
          <option value="error,warn">Errors + Warnings</option>
          <option value="success">Success only</option>
          <option value="info">Info only</option>
        </select>
        <select
          value={logSourceFilter}
          onChange={(e) => setLogSourceFilter(e.target.value)}
          className="text-xs border border-[#dadce0] rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-[#0b57d0]"
          data-testid="select-log-source"
        >
          <option value="all">All sources</option>
          {sources.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="flex-1 bg-[#1e1e1e] rounded-lg font-mono text-xs overflow-auto min-h-[300px] max-h-[calc(85vh-240px)]">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading logs...
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <AlertCircle className="w-8 h-8 mb-2 text-red-400 opacity-70" />
            <p>Failed to load logs</p>
            <button onClick={() => refetch()} className="text-blue-400 text-[11px] mt-1 hover:underline">Retry</button>
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <Code className="w-8 h-8 mb-2 opacity-50" />
            <p>{queryString ? "No matching log entries" : "No log entries yet"}</p>
            <p className="text-[10px] mt-1 opacity-60">{queryString ? "Try adjusting your filters" : "Events will appear here as they occur"}</p>
          </div>
        ) : (
          <div className="p-3 space-y-0.5">
            {logs.map((log, i) => {
              const ts = new Date(log.timestamp);
              const timeStr = ts.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
              const dateStr = ts.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              return (
                <div key={i} className={`flex gap-2 leading-5 hover:bg-white/5 px-1 rounded ${log.level === "error" ? "bg-red-950/20" : ""}`} data-testid={`log-entry-${i}`}>
                  <span className="text-gray-600 shrink-0">{dateStr} {timeStr}</span>
                  <span className={`shrink-0 font-bold ${levelColor(log.level)}`}>[{levelBadge(log.level)}]</span>
                  <span className="text-blue-400 shrink-0">{log.source}</span>
                  <span className="text-gray-300">{log.message}</span>
                </div>
              );
            })}
            <div ref={logEndRef} />
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-xs text-[#5f6368] cursor-pointer">
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} className="accent-[#0b57d0]" />
          Auto-scroll
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#5f6368]">{logs.length} shown</span>
          <button
            onClick={() => window.open("/logs", "localmail-logs", "width=1000,height=600")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2d2d2d] hover:bg-[#3d3d3d] text-gray-400 hover:text-gray-200 text-xs font-medium transition-colors border border-[#404040]"
            data-testid="button-open-logs-window"
          >
            <ExternalLink className="w-3 h-3" />
            Pop out
          </button>
        </div>
      </div>
    </div>
  );
}

function AboutPanel() {
  const [openVersions, setOpenVersions] = useState<Set<string>>(new Set(["v0.8"]));

  const toggleVersion = (v: string) => {
    setOpenVersions(prev => {
      const next = new Set(Array.from(prev));
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  };

  const versions = [
    {
      version: "v0.8",
      label: "Latest",
      date: "April 2026",
      summary: "Search improvements, drag-and-drop attachments, account UX overhaul",
      items: [
        "From / Sender filter input added to the search filter panel",
        "Drag-and-drop file attachment in the compose window and inline reply",
        "Quick connection test button on each saved account card",
        "Account settings split into separate 'My Accounts' and 'Add Account' tabs",
        "About page added with version history",
      ],
    },
    {
      version: "v0.7",
      label: "",
      date: "April 2026",
      summary: "Compose polish, reply style setting, hover states",
      items: [
        "Reply style preference: pop-out window or inline composer",
        "Draft saving fixed — no phantom drafts created on reply pre-fill",
        "Compose panel focuses the message body (not To) when replying",
        "All 28 toolbar icon buttons given consistent hover highlight",
        "More Actions (⋮) menu fixed — no longer closes immediately on open",
        "Print redesigned as a dedicated popup showing only email content",
      ],
    },
    {
      version: "v0.6",
      label: "",
      date: "April 2026",
      summary: "Multiple accounts, auto-fetch, smart send routing",
      items: [
        "Multiple POP3 / IMAP mail accounts in a single inbox",
        "Per-account auto-fetch with configurable intervals (5 – 60 min)",
        "Smart send-account matching: replies route through the receiving account",
        "Inline account editing without re-entering the full password",
        "POP3 delete-on-fetch vs keep-on-server toggle",
        "Connection test for both incoming and outgoing servers",
      ],
    },
    {
      version: "v0.5",
      label: "",
      date: "March 2026",
      summary: "Advanced search and filter panel",
      items: [
        "Filter panel with scope (current folder / all mail)",
        "Date range filter: last 7 days, 30 days, 3 months, or 1 year",
        "Toggle filters: unread only, starred only, has attachment",
        "Search in email body toggle",
        "Search operator hints: from:, subject:, has:attachment",
        "Active filter count badge on the filter button",
      ],
    },
    {
      version: "v0.4",
      label: "",
      date: "March 2026",
      summary: "Automation, notifications, backup, and spam tools",
      items: [
        "Vacation / out-of-office auto-reply with date range scheduling",
        "Spam detection and spam folder management",
        "Unsubscribe link detection with one-click unsubscribe prompt",
        "Desktop and in-app notifications for new mail",
        "Cloud backup engine with configurable provider and schedule",
        "Trash and spam auto-purge with configurable retention period",
      ],
    },
    {
      version: "v0.3",
      label: "",
      date: "March 2026",
      summary: "Interface enhancements and attachment preview",
      items: [
        "Dark mode across the full application",
        "Collapsible sidebar for a wider reading area",
        "Attachment preview: images, PDFs, spreadsheets, and archives",
        "Print-friendly email view",
        "Real-time activity logs panel (pop-out window supported)",
        "Configurable email density and conversation view",
      ],
    },
    {
      version: "v0.2",
      label: "",
      date: "March 2026",
      summary: "Labels, folders, and email rules",
      items: [
        "Custom labels with colour coding — apply multiple per email",
        "Custom folders with drag-and-drop email organisation",
        "Email rules engine: auto-label, move, star, or delete on arrival",
        "Drag emails from the list to sidebar folders",
        "Star and archive shortcuts from the email list",
        "Sent, Drafts, Spam, Trash folder views",
      ],
    },
    {
      version: "v0.1",
      label: "Initial release",
      date: "March 2026",
      summary: "Core foundation: compose, encryption, multi-user, POP3/IMAP/SMTP",
      items: [
        "POP3 and IMAP support for receiving mail",
        "SMTP for sending email with CC and BCC fields",
        "AES-256 encrypted file-based email and settings storage",
        "Multi-user login with session management",
        "Admin panel for user and system management",
        "Docker, Linux, and Windows deployment support",
        "Full compose window with expand to fullscreen",
        "Inline reply composer embedded in the email view",
        "Reply, Reply All, and Forward with collapsible quoted text",
        "Auto-saving drafts while composing",
        "Rich text formatting: bold, italic, underline, lists, and hyperlinks",
        "HTML email rendering with DOMPurify sanitisation",
      ],
    },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-[#1a73e8] flex items-center justify-center flex-shrink-0">
          <Mail className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-[#202124]">LocalMail</h2>
          <p className="text-xs text-[#5f6368] mt-0.5">Current version: v0.8</p>
          <p className="text-sm text-[#3c4043] mt-2 leading-relaxed max-w-[560px]">
            A locally-hosted email client, inspired by Gmail, with POP3/IMAP/SMTP support. All emails and settings encrypted at rest.
          </p>
        </div>
      </div>

      <Separator />

      {/* Version history */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <ListChecks className="w-4 h-4 text-[#1a73e8]" />
          <h3 className="text-sm font-semibold text-[#202124]">Version History</h3>
        </div>
        <div className="space-y-2">
          {versions.map(v => {
            const isOpen = openVersions.has(v.version);
            return (
              <div
                key={v.version}
                className={`border rounded-lg overflow-hidden transition-colors ${isOpen ? "border-[#1a73e8]/40 bg-white" : "border-[#e8eaed] bg-[#fafbfd]"}`}
              >
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#f1f3f4] transition-colors"
                  onClick={() => toggleVersion(v.version)}
                  data-testid={`version-toggle-${v.version}`}
                >
                  <span className={`text-xs font-mono font-semibold px-1.5 py-0.5 rounded ${isOpen ? "bg-[#1a73e8] text-white" : "bg-[#e8eaed] text-[#5f6368]"}`}>
                    {v.version}
                  </span>
                  {v.label && (
                    <span className="text-[10px] font-medium bg-[#e6f4ea] text-[#137333] px-1.5 py-0.5 rounded-full">
                      {v.label}
                    </span>
                  )}
                  <span className="text-xs text-[#5f6368] flex-shrink-0">{v.date}</span>
                  <span className="text-xs text-[#3c4043] flex-1 ml-1 truncate">{v.summary}</span>
                  <ChevronDown className={`w-3.5 h-3.5 text-[#5f6368] flex-shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen && (
                  <div className="px-4 pb-3 border-t border-[#e8eaed]">
                    <ul className="space-y-1.5 pt-3">
                      {v.items.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-[#3c4043]">
                          <CheckCircle className="w-3 h-3 text-[#34a853] flex-shrink-0 mt-0.5" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <Separator />

      {/* Deployment info */}
      <div className="flex items-start gap-3 bg-[#e8f0fe] rounded-lg px-4 py-3">
        <Info className="w-4 h-4 text-[#1a73e8] flex-shrink-0 mt-0.5" />
        <div className="text-xs text-[#202124] space-y-0.5">
          <p className="font-medium">Deployment</p>
          <p className="text-[#5f6368]">LocalMail runs on Linux, Windows, and macOS. A Docker image (<span className="font-mono">jahuuk/localmail-app</span>) is available for containerised deployment with a named volume for persistent, encrypted storage.</p>
        </div>
      </div>
    </div>
  );
}

function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [activeTab, setActiveTab] = useState<
    "appearance" | "notifications" | "vacation" | "composing" |
    "accounts" | "add-account" | "rules" | "labels" | "folders" |
    "storage" | "backup" | "logs" | "about"
  >("appearance");

  const GROUPS = [
    {
      label: "Preferences",
      items: [
        { id: "appearance" as const, label: "Appearance", icon: Sun },
        { id: "notifications" as const, label: "Notifications", icon: Bell },
        { id: "vacation" as const, label: "Vacation Reply", icon: Palmtree },
      ],
    },
    {
      label: "Email",
      items: [
        { id: "composing" as const, label: "Composing", icon: Pencil },
        { id: "accounts" as const, label: "My Accounts", icon: Mail },
        { id: "add-account" as const, label: "Add Account", icon: PlusCircle },
        { id: "rules" as const, label: "Rules", icon: Shield },
      ],
    },
    {
      label: "Organisation",
      items: [
        { id: "labels" as const, label: "Labels", icon: Tag },
        { id: "folders" as const, label: "Folders", icon: Folder },
      ],
    },
    {
      label: "System",
      items: [
        { id: "storage" as const, label: "Storage", icon: Trash2 },
        { id: "backup" as const, label: "Backup", icon: HardDrive },
        { id: "logs" as const, label: "Logs", icon: Code },
        { id: "about" as const, label: "About", icon: Info },
      ],
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[1060px] h-[90vh] p-0 gap-0 overflow-hidden" aria-describedby={undefined}>
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <div className="flex h-full overflow-hidden">
          {/* Sidebar */}
          <div className="w-[220px] border-r border-[#e0e0e0] bg-[#f6f8fc] flex flex-col overflow-y-auto flex-shrink-0">
            <div className="px-5 py-4 flex items-center gap-2.5 border-b border-[#e0e0e0]">
              <Settings className="h-5 w-5 text-[#1a73e8]" />
              <span className="text-base font-semibold text-[#202124]">Settings</span>
            </div>
            <nav className="flex-1 py-2">
              {GROUPS.map(group => (
                <div key={group.label} className="mb-1">
                  <div className="px-5 py-2 text-[10px] font-bold uppercase tracking-widest text-[#9aa0a6]">
                    {group.label}
                  </div>
                  {group.items.map(item => (
                    <button
                      key={item.id}
                      onClick={() => setActiveTab(item.id)}
                      className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors text-left rounded-none ${
                        activeTab === item.id
                          ? "bg-[#d3e3fd] text-[#001d35] font-medium"
                          : "text-[#444746] hover:bg-[#e8eaed]/70"
                      }`}
                      data-testid={`tab-settings-${item.id}`}
                    >
                      <item.icon className="w-4 h-4 flex-shrink-0" />
                      {item.label}
                    </button>
                  ))}
                </div>
              ))}
            </nav>
          </div>

          {/* Content area */}
          <div className="flex-1 overflow-y-auto min-h-0 bg-white">
            {activeTab === "appearance"    && <AppearancePanel />}
            {activeTab === "notifications" && <NotificationsPanel />}
            {activeTab === "vacation"      && <VacationPanel />}
            {activeTab === "composing"     && <ComposingPanel />}
            {activeTab === "accounts"      && <MyAccountsPanel />}
            {activeTab === "add-account"   && <AddAccountPanel />}
            {activeTab === "rules"         && <RulesSettings />}
            {activeTab === "labels"        && <LabelsSettings />}
            {activeTab === "folders"       && <FoldersSettings />}
            {activeTab === "storage"       && <StoragePanel />}
            {activeTab === "backup"        && <BackupSettings />}
            {activeTab === "logs"          && <LogsPanel />}
            {activeTab === "about"         && <AboutPanel />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TestResultBadge({ result }: { result: { success: boolean; message: string } | null }) {
  if (!result) return null;
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs mt-2 ${
      result.success ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"
    }`}>
      {result.success ? <CheckCircle className="h-3.5 w-3.5 flex-shrink-0" /> : <XCircle className="h-3.5 w-3.5 flex-shrink-0" />}
      <span>{result.message}</span>
    </div>
  );
}

function MyAccountsPanel() {
  const [testingAccountIds, setTestingAccountIds] = useState<Set<string>>(new Set());
  const [accountTestResults, setAccountTestResults] = useState<Map<string, { success: boolean; message: string }>>(new Map());

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const testSavedAccount = async (account: MailAccount) => {
    setTestingAccountIds(prev => { const s = new Set(Array.from(prev)); s.add(account.id); return s; });
    setAccountTestResults(prev => { const m = new Map(Array.from(prev)); m.delete(account.id); return m; });
    try {
      const res = await apiRequest("POST", `/api/accounts/${account.id}/test`, {});
      const data = await res.json();
      const incoming = data.incoming as { success: boolean; message: string };
      const smtp = data.smtp as { success: boolean; message: string } | undefined;
      const overallSuccess = incoming.success && (smtp ? smtp.success : true);
      const smtpPart = smtp ? ` · SMTP: ${smtp.success ? "OK" : smtp.message}` : "";
      setAccountTestResults(prev => {
        const m = new Map(Array.from(prev));
        m.set(account.id, { success: overallSuccess, message: `${incoming.success ? "OK" : incoming.message}${smtpPart}` });
        return m;
      });
    } catch (e: any) {
      setAccountTestResults(prev => { const m = new Map(Array.from(prev)); m.set(account.id, { success: false, message: e.message || "Connection failed" }); return m; });
    } finally {
      setTestingAccountIds(prev => { const s = new Set(Array.from(prev)); s.delete(account.id); return s; });
    }
  };

  const accountsQuery = useQuery<MailAccount[]>({
    queryKey: ["/api/accounts"],
    refetchInterval: 30000,
  });

  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string; email: string; protocol: "pop3" | "imap"; host: string; port: string;
    username: string; password: string; tls: boolean; deleteOnFetch: boolean;
    smtpHost: string; smtpPort: string; smtpTls: boolean;
  }>({ name: "", email: "", protocol: "pop3", host: "", port: "995", username: "", password: "", tls: true, deleteOnFetch: false, smtpHost: "", smtpPort: "587", smtpTls: true });
  const [editIncomingTestResult, setEditIncomingTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [editSmtpTestResult, setEditSmtpTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [editTestingIncoming, setEditTestingIncoming] = useState(false);
  const [editTestingSmtp, setEditTestingSmtp] = useState(false);

  const startEditing = (account: MailAccount) => {
    setEditingAccountId(account.id);
    setEditForm({
      name: account.name, email: account.email, protocol: (account.protocol as "pop3" | "imap") || "pop3",
      host: account.host, port: String(account.port), username: account.username, password: "",
      tls: account.tls !== false, deleteOnFetch: account.deleteOnFetch || false,
      smtpHost: account.smtpHost || "", smtpPort: String(account.smtpPort || 587), smtpTls: account.smtpTls !== false,
    });
    setEditIncomingTestResult(null);
    setEditSmtpTestResult(null);
  };

  const saveEdit = async () => {
    if (!editingAccountId) return;
    const updates: any = {
      name: editForm.name, email: editForm.email, protocol: editForm.protocol,
      host: editForm.host, port: parseInt(editForm.port), username: editForm.username,
      tls: editForm.tls, deleteOnFetch: editForm.protocol === "pop3" ? editForm.deleteOnFetch : undefined,
      smtpHost: editForm.smtpHost || undefined, smtpPort: editForm.smtpPort ? parseInt(editForm.smtpPort) : undefined,
      smtpTls: editForm.smtpTls,
    };
    if (editForm.password) updates.password = editForm.password;
    updateAccountMutation.mutate({ id: editingAccountId, updates }, {
      onSuccess: () => {
        toast({ title: "Account updated" });
        setEditingAccountId(null);
      },
    });
  };

  const testEditIncoming = async () => {
    setEditTestingIncoming(true);
    setEditIncomingTestResult(null);
    try {
      const res = await apiRequest("POST", "/api/accounts/test-incoming", {
        protocol: editForm.protocol, host: editForm.host, port: parseInt(editForm.port),
        username: editForm.username, password: editForm.password, tls: editForm.tls,
      });
      const data = await res.json();
      setEditIncomingTestResult(data);
    } catch (err: any) {
      setEditIncomingTestResult({ success: false, message: err.message });
    } finally {
      setEditTestingIncoming(false);
    }
  };

  const testEditSmtp = async () => {
    setEditTestingSmtp(true);
    setEditSmtpTestResult(null);
    try {
      const res = await apiRequest("POST", "/api/accounts/test-smtp", {
        host: editForm.smtpHost, port: parseInt(editForm.smtpPort),
        username: editForm.username, password: editForm.password, tls: editForm.smtpTls,
      });
      const data = await res.json();
      setEditSmtpTestResult(data);
    } catch (err: any) {
      setEditSmtpTestResult({ success: false, message: err.message });
    } finally {
      setEditTestingSmtp(false);
    }
  };

  const [fetchingAccounts, setFetchingAccounts] = useState<Set<string>>(new Set());

  const fetchAccount = async (id: string) => {
    setFetchingAccounts(prev => new Set(prev).add(id));
    try {
      const res = await apiRequest("POST", `/api/accounts/${id}/fetch`);
      const data = await res.json();
      queryClient.invalidateQueries();
      toast({ title: data.message || "Emails fetched" });
    } catch (err: any) {
      toast({ title: "Fetch failed", description: err.message, variant: "destructive" });
    } finally {
      setFetchingAccounts(prev => { const next = new Set(prev); next.delete(id); return next; });
    }
  };

  const fetchAllAccounts = async () => {
    const accounts = accountsQuery.data || [];
    if (accounts.length === 0) return;
    await Promise.all(accounts.map(a => fetchAccount(a.id)));
  };

  const updateAccountMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<MailAccount> }) => {
      const res = await apiRequest("PATCH", `/api/accounts/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update account", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/accounts/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      toast({ title: "Account removed" });
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-base font-medium text-[#202124] mb-1">Connected Accounts</h3>
        <p className="text-xs text-[#5f6368]">Manage your existing incoming and outgoing mail server connections.</p>
      </div>

      {(accountsQuery.data?.length ?? 0) > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-[#5f6368]">Connected Accounts</h4>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchAllAccounts}
              disabled={fetchingAccounts.size > 0}
              data-testid="button-fetch-all"
            >
              <RefreshCw className={`h-3 w-3 mr-1 ${fetchingAccounts.size > 0 ? "animate-spin" : ""}`} /> Fetch All
            </Button>
          </div>
          {accountsQuery.data?.map(account => (
            <div key={account.id} className="p-3 border border-[#dadce0] rounded-lg bg-white space-y-2">
              {editingAccountId === account.id ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h5 className="text-sm font-medium text-[#202124]">Edit Account</h5>
                    <Button variant="ghost" size="sm" onClick={() => setEditingAccountId(null)} data-testid="button-cancel-edit">Cancel</Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-[#5f6368]">Display Name</Label>
                      <Input value={editForm.name} onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))} data-testid="input-edit-name" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-[#5f6368]">Email Address</Label>
                      <Input value={editForm.email} onChange={(e) => setEditForm(f => ({ ...f, email: e.target.value }))} data-testid="input-edit-email" />
                    </div>
                  </div>

                  <div className="border border-[#dadce0] rounded-lg p-3 space-y-3 bg-[#fafbfd]">
                    <div className="flex items-center justify-between">
                      <h5 className="text-xs font-medium text-[#202124]">Incoming Mail Server</h5>
                      <div className="flex rounded-full border border-[#dadce0] overflow-hidden">
                        <button onClick={() => setEditForm(f => ({ ...f, protocol: "pop3", port: "995" }))}
                          className={`px-2.5 py-0.5 text-xs font-medium transition-colors ${editForm.protocol === "pop3" ? "bg-[#0b57d0] text-white" : "text-[#5f6368] hover:bg-[#e8eaed]"}`}
                          data-testid="button-edit-protocol-pop3">POP3</button>
                        <button onClick={() => setEditForm(f => ({ ...f, protocol: "imap", port: "993" }))}
                          className={`px-2.5 py-0.5 text-xs font-medium transition-colors ${editForm.protocol === "imap" ? "bg-[#0b57d0] text-white" : "text-[#5f6368] hover:bg-[#e8eaed]"}`}
                          data-testid="button-edit-protocol-imap">IMAP</button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2 space-y-1.5">
                        <Label className="text-xs text-[#5f6368]">{editForm.protocol === "pop3" ? "POP3" : "IMAP"} Host</Label>
                        <Input value={editForm.host} onChange={(e) => { setEditForm(f => ({ ...f, host: e.target.value })); setEditIncomingTestResult(null); }} data-testid="input-edit-host" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-[#5f6368]">Port</Label>
                        <Input value={editForm.port} onChange={(e) => { setEditForm(f => ({ ...f, port: e.target.value })); setEditIncomingTestResult(null); }} data-testid="input-edit-port" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-[#5f6368]">Username</Label>
                        <Input value={editForm.username} onChange={(e) => { setEditForm(f => ({ ...f, username: e.target.value })); setEditIncomingTestResult(null); setEditSmtpTestResult(null); }} data-testid="input-edit-username" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-[#5f6368]">Password</Label>
                        <Input type="password" value={editForm.password} onChange={(e) => { setEditForm(f => ({ ...f, password: e.target.value })); setEditIncomingTestResult(null); setEditSmtpTestResult(null); }} placeholder="Leave blank to keep current" data-testid="input-edit-password" />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={editForm.tls} onChange={(e) => setEditForm(f => ({ ...f, tls: e.target.checked }))} id={`edit-tls-${account.id}`} className="accent-[#1a73e8]" />
                      <Label htmlFor={`edit-tls-${account.id}`} className="text-xs text-[#5f6368]">Use TLS/SSL encryption</Label>
                    </div>
                    {editForm.protocol === "pop3" && (
                      <div className="flex items-center gap-2">
                        <input type="checkbox" checked={editForm.deleteOnFetch} onChange={(e) => setEditForm(f => ({ ...f, deleteOnFetch: e.target.checked }))} id={`edit-delete-${account.id}`} className="accent-[#1a73e8]" />
                        <Label htmlFor={`edit-delete-${account.id}`} className="text-xs text-[#5f6368]">Delete from server after fetch</Label>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={testEditIncoming}
                        disabled={editTestingIncoming || !editForm.host || !editForm.port || !editForm.username || !editForm.password}
                        data-testid="button-test-edit-incoming">
                        {editTestingIncoming ? <><RefreshCw className="h-3 w-3 mr-1 animate-spin" /> Testing...</> : "Test Incoming"}
                      </Button>
                      {editIncomingTestResult && (
                        <span className={`text-xs ${editIncomingTestResult.success ? "text-green-600" : "text-red-600"}`}>
                          {editIncomingTestResult.success ? "Connected" : editIncomingTestResult.message}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="border border-[#dadce0] rounded-lg p-3 space-y-3 bg-[#fafbfd]">
                    <h5 className="text-xs font-medium text-[#202124]">Outgoing Mail Server (SMTP)</h5>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2 space-y-1.5">
                        <Label className="text-xs text-[#5f6368]">SMTP Host</Label>
                        <Input value={editForm.smtpHost} onChange={(e) => { setEditForm(f => ({ ...f, smtpHost: e.target.value })); setEditSmtpTestResult(null); }} data-testid="input-edit-smtp-host" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-[#5f6368]">Port</Label>
                        <Input value={editForm.smtpPort} onChange={(e) => { setEditForm(f => ({ ...f, smtpPort: e.target.value })); setEditSmtpTestResult(null); }} data-testid="input-edit-smtp-port" />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={editForm.smtpTls} onChange={(e) => setEditForm(f => ({ ...f, smtpTls: e.target.checked }))} id={`edit-smtp-tls-${account.id}`} className="accent-[#1a73e8]" />
                      <Label htmlFor={`edit-smtp-tls-${account.id}`} className="text-xs text-[#5f6368]">Use TLS/SSL</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={testEditSmtp}
                        disabled={editTestingSmtp || !editForm.smtpHost || !editForm.smtpPort || !editForm.username || !editForm.password}
                        data-testid="button-test-edit-smtp">
                        {editTestingSmtp ? <><RefreshCw className="h-3 w-3 mr-1 animate-spin" /> Testing...</> : "Test SMTP"}
                      </Button>
                      {editSmtpTestResult && (
                        <span className={`text-xs ${editSmtpTestResult.success ? "text-green-600" : "text-red-600"}`}>
                          {editSmtpTestResult.success ? "Connected" : editSmtpTestResult.message}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <Button variant="outline" size="sm" onClick={() => setEditingAccountId(null)} data-testid="button-edit-cancel">Cancel</Button>
                    <Button size="sm" onClick={saveEdit} className="bg-[#0b57d0] hover:bg-[#0842a0] text-white" data-testid="button-edit-save">Save Changes</Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-sm text-[#202124]">{account.name}</div>
                      <div className="text-xs text-[#5f6368]">{account.email}</div>
                      <div className="text-xs text-[#5f6368] mt-0.5">
                        {account.host}:{account.port} ({(account.protocol || "pop3").toUpperCase()}{account.tls ? "/TLS" : ""})
                        {account.smtpHost && ` · SMTP: ${account.smtpHost}:${account.smtpPort}`}
                      </div>
                      {(account.protocol || "pop3") === "pop3" && (
                        <div className="text-xs text-[#5f6368] mt-0.5">
                          {account.deleteOnFetch ? "Delete from server after fetch" : "Keep messages on server"}
                        </div>
                      )}
                      {account.lastFetched && (
                        <div className="text-xs text-[#5f6368] mt-0.5">Last fetched: {format(new Date(account.lastFetched), "MMM d, h:mm a")}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => startEditing(account)}
                        data-testid={`button-edit-${account.id}`}
                      >
                        <Pencil className="h-3 w-3 mr-1" /> Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fetchAccount(account.id)}
                        disabled={fetchingAccounts.has(account.id)}
                        data-testid={`button-fetch-${account.id}`}
                      >
                        <RefreshCw className={`h-3 w-3 mr-1 ${fetchingAccounts.has(account.id) ? "animate-spin" : ""}`} /> Fetch
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => testSavedAccount(account)}
                        disabled={testingAccountIds.has(account.id)}
                        data-testid={`button-test-account-${account.id}`}
                      >
                        {testingAccountIds.has(account.id) ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <CheckCircle className="h-3 w-3 mr-1" />
                        )}
                        Test
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-500 hover:text-red-600"
                        onClick={() => deleteMutation.mutate(account.id)}
                        data-testid={`button-delete-account-${account.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="border-t border-[#e8eaed] pt-2 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[#5f6368]">Auto-fetch:</span>
                        <button
                          onClick={() => updateAccountMutation.mutate({
                            id: account.id,
                            updates: { autoFetchEnabled: !(account.autoFetchEnabled !== false) }
                          })}
                          className={`w-8 h-5 rounded-full transition-colors relative ${
                            account.autoFetchEnabled !== false ? "bg-[#0b57d0]" : "bg-[#dadce0]"
                          }`}
                          data-testid={`toggle-auto-fetch-${account.id}`}
                        >
                          <div className={`w-3.5 h-3.5 bg-white rounded-full absolute top-[3px] transition-all ${
                            account.autoFetchEnabled !== false ? "left-[14px]" : "left-[3px]"
                          }`} />
                        </button>
                      </div>
                      {account.autoFetchEnabled !== false && (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-[#5f6368]">every</span>
                          <select
                            value={account.autoFetchInterval || 30}
                            onChange={(e) => updateAccountMutation.mutate({
                              id: account.id,
                              updates: { autoFetchInterval: parseInt(e.target.value) }
                            })}
                            className="text-xs border border-[#dadce0] rounded px-1.5 py-0.5 bg-white"
                            data-testid={`select-fetch-interval-${account.id}`}
                          >
                            <option value="5">5 min</option>
                            <option value="10">10 min</option>
                            <option value="15">15 min</option>
                            <option value="30">30 min</option>
                            <option value="60">60 min</option>
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                  {accountTestResults.has(account.id) && (
                    <TestResultBadge result={accountTestResults.get(account.id)!} />
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {(accountsQuery.data?.length ?? 0) === 0 && (
        <div className="text-center py-12 text-[#5f6368]">
          <Mail className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No accounts yet</p>
          <p className="text-xs mt-1">Go to "Add Account" to connect your first mail account.</p>
        </div>
      )}
    </div>
  );
}

function AddAccountPanel() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [incomingProtocol, setIncomingProtocol] = useState<"pop3" | "imap">("pop3");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("995");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [tls, setTls] = useState(true);
  const [deleteOnFetch, setDeleteOnFetch] = useState(false);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpTls, setSmtpTls] = useState(true);
  const [autoFetchEnabled, setAutoFetchEnabled] = useState(true);
  const [autoFetchInterval, setAutoFetchInterval] = useState(30);
  const [incomingTestResult, setIncomingTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [smtpTestResult, setSmtpTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/accounts", {
        name, email, protocol: incomingProtocol, host, port: parseInt(port), username, password, tls,
        deleteOnFetch: incomingProtocol === "pop3" ? deleteOnFetch : undefined,
        smtpHost: smtpHost || undefined,
        smtpPort: smtpPort ? parseInt(smtpPort) : undefined,
        smtpTls,
        autoFetchEnabled,
        autoFetchInterval,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      toast({ title: "Account added successfully" });
      setName(""); setEmail(""); setHost(""); setPort("995"); setUsername(""); setPassword(""); setSmtpHost(""); setSmtpPort("587");
      setDeleteOnFetch(false); setIncomingTestResult(null); setSmtpTestResult(null);
      setAutoFetchEnabled(true); setAutoFetchInterval(30);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add account", description: err.message, variant: "destructive" });
    },
  });

  const testIncomingMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/accounts/test-incoming", {
        protocol: incomingProtocol, host, port: parseInt(port), username, password, tls,
      });
      return res.json();
    },
    onSuccess: (data: { success: boolean; message: string }) => setIncomingTestResult(data),
    onError: (err: Error) => setIncomingTestResult({ success: false, message: err.message }),
  });

  const testSmtpMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/accounts/test-smtp", {
        host: smtpHost, port: parseInt(smtpPort), username, password, tls: smtpTls,
      });
      return res.json();
    },
    onSuccess: (data: { success: boolean; message: string }) => setSmtpTestResult(data),
    onError: (err: Error) => setSmtpTestResult({ success: false, message: err.message }),
  });

  const handleProtocolChange = (protocol: "pop3" | "imap") => {
    setIncomingProtocol(protocol);
    if (protocol === "pop3") setPort("995");
    else setPort("993");
    setIncomingTestResult(null);
  };

  const canTestIncoming = host && port && username && password;
  const canTestSmtp = smtpHost && smtpPort && username && password;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-base font-medium text-[#202124] mb-1">Add New Account</h3>
        <p className="text-xs text-[#5f6368]">Connect an email account using POP3 or IMAP for incoming mail, and SMTP for sending.</p>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-[#5f6368]">Display Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Work Gmail" data-testid="input-account-name" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-[#5f6368]">Email Address</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" data-testid="input-account-email" />
          </div>
        </div>

        {/* Incoming mail */}
        <div className="border border-[#dadce0] rounded-lg p-4 space-y-3 bg-[#fafbfd]">
          <div className="flex items-center justify-between">
            <h5 className="text-sm font-medium text-[#202124]">Incoming Mail Server</h5>
            <div className="flex rounded-full border border-[#dadce0] overflow-hidden">
              <button
                onClick={() => handleProtocolChange("pop3")}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  incomingProtocol === "pop3" ? "bg-[#0b57d0] text-white" : "text-[#5f6368] hover:bg-[#e8eaed]"
                }`}
                data-testid="button-protocol-pop3"
              >
                POP3
              </button>
              <button
                onClick={() => handleProtocolChange("imap")}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  incomingProtocol === "imap" ? "bg-[#0b57d0] text-white" : "text-[#5f6368] hover:bg-[#e8eaed]"
                }`}
                data-testid="button-protocol-imap"
              >
                IMAP
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs text-[#5f6368]">{incomingProtocol === "pop3" ? "POP3" : "IMAP"} Host</Label>
              <Input value={host} onChange={(e) => { setHost(e.target.value); setIncomingTestResult(null); }} placeholder={incomingProtocol === "pop3" ? "pop.gmail.com" : "imap.gmail.com"} data-testid="input-incoming-host" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#5f6368]">Port</Label>
              <Input value={port} onChange={(e) => { setPort(e.target.value); setIncomingTestResult(null); }} placeholder={incomingProtocol === "pop3" ? "995" : "993"} data-testid="input-incoming-port" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-[#5f6368]">Username</Label>
              <Input value={username} onChange={(e) => { setUsername(e.target.value); setIncomingTestResult(null); setSmtpTestResult(null); }} placeholder="user@gmail.com" data-testid="input-incoming-username" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#5f6368]">Password</Label>
              <Input type="password" value={password} onChange={(e) => { setPassword(e.target.value); setIncomingTestResult(null); setSmtpTestResult(null); }} placeholder="App password" data-testid="input-incoming-password" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={tls} onChange={(e) => { setTls(e.target.checked); setIncomingTestResult(null); }} id="incoming-tls" className="accent-[#1a73e8]" />
            <Label htmlFor="incoming-tls" className="text-xs text-[#5f6368]">Use TLS/SSL encryption</Label>
          </div>

          {incomingProtocol === "pop3" && (
            <div className="border-t border-[#e0e0e0] pt-3 space-y-2">
              <Label className="text-xs text-[#5f6368] font-medium">When messages are retrieved via POP3:</Label>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="deleteOnFetch"
                    checked={!deleteOnFetch}
                    onChange={() => setDeleteOnFetch(false)}
                    className="accent-[#1a73e8]"
                  />
                  <span className="text-xs text-[#202124]">Keep a copy on the server</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="deleteOnFetch"
                    checked={deleteOnFetch}
                    onChange={() => setDeleteOnFetch(true)}
                    className="accent-[#1a73e8]"
                  />
                  <span className="text-xs text-[#202124]">Delete from server after fetching</span>
                </label>
              </div>
              {deleteOnFetch && (
                <p className="text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded">
                  Messages will be permanently removed from the server after download. They will only exist in LocalMail.
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <button
              onClick={() => testIncomingMutation.mutate()}
              disabled={!canTestIncoming || testIncomingMutation.isPending}
              className="flex items-center gap-1.5 text-xs font-medium text-[#0b57d0] hover:text-[#1a73e8] disabled:text-[#dadce0] disabled:cursor-not-allowed transition-colors"
              data-testid="button-test-incoming"
            >
              {testIncomingMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle className="h-3.5 w-3.5" />
              )}
              {testIncomingMutation.isPending ? "Testing..." : `Test ${incomingProtocol.toUpperCase()} Connection`}
            </button>
          </div>
          <TestResultBadge result={incomingTestResult} />
        </div>

        {/* Outgoing mail */}
        <div className="border border-[#dadce0] rounded-lg p-4 space-y-3 bg-[#fafbfd]">
          <h5 className="text-sm font-medium text-[#202124]">Outgoing Mail Server (SMTP)</h5>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs text-[#5f6368]">SMTP Host</Label>
              <Input value={smtpHost} onChange={(e) => { setSmtpHost(e.target.value); setSmtpTestResult(null); }} placeholder="smtp.gmail.com" data-testid="input-smtp-host" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#5f6368]">SMTP Port</Label>
              <Input value={smtpPort} onChange={(e) => { setSmtpPort(e.target.value); setSmtpTestResult(null); }} placeholder="587" data-testid="input-smtp-port" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={smtpTls} onChange={(e) => { setSmtpTls(e.target.checked); setSmtpTestResult(null); }} id="smtp-tls" className="accent-[#1a73e8]" />
            <Label htmlFor="smtp-tls" className="text-xs text-[#5f6368]">Use TLS/SSL encryption</Label>
          </div>
          <p className="text-xs text-[#5f6368]">Uses same credentials as incoming server. Port 587 uses STARTTLS, port 465 uses SSL.</p>

          <div className="flex items-center justify-between pt-1">
            <button
              onClick={() => testSmtpMutation.mutate()}
              disabled={!canTestSmtp || testSmtpMutation.isPending}
              className="flex items-center gap-1.5 text-xs font-medium text-[#0b57d0] hover:text-[#1a73e8] disabled:text-[#dadce0] disabled:cursor-not-allowed transition-colors"
              data-testid="button-test-smtp"
            >
              {testSmtpMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle className="h-3.5 w-3.5" />
              )}
              {testSmtpMutation.isPending ? "Testing..." : "Test SMTP Connection"}
            </button>
          </div>
          <TestResultBadge result={smtpTestResult} />
        </div>

        <div className="flex justify-end">
          <Button
            onClick={() => addMutation.mutate()}
            disabled={!name || !email || !host || !username || !password || addMutation.isPending}
            className="rounded-full px-6"
            style={{ backgroundColor: "#0b57d0" }}
            data-testid="button-add-account"
          >
            {addMutation.isPending ? "Adding..." : "Add Account"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DefaultSendAccountSetting({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const accountsQuery = useQuery<Pop3Account[]>({
    queryKey: ["/api/accounts"],
  });
  const smtpAccounts = (accountsQuery.data || []).filter(a => a.smtpHost);

  if (smtpAccounts.length === 0) {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs text-[#5f6368]">Default send account</Label>
        <p className="text-xs text-[#5f6368]">No accounts with SMTP configured. Add SMTP details to an account to send emails.</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-[#5f6368]">Default send account</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-[#dadce0] rounded-lg p-2.5 text-sm outline-none focus:border-[#0b57d0] bg-white"
        data-testid="select-default-send-account"
      >
        <option value="__smart__">Smart match — reply from the account the email was received on</option>
        <option value="">None — choose each time</option>
        {smtpAccounts.map(a => (
          <option key={a.id} value={a.id}>{a.name} ({a.email})</option>
        ))}
      </select>
      <p className="text-xs text-[#5f6368]">
        {value === "__smart__"
          ? "When replying, LocalMail will automatically send from whichever of your accounts received the original email."
          : value
          ? "This account will be pre-selected when composing new emails."
          : "You'll be prompted to choose an account each time you compose."}
      </p>
    </div>
  );
}

// ─── Shared layout helpers ────────────────────────────────────────────────────

function SettingRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-0.5">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[#202124]">{label}</div>
        <div className="text-xs text-[#5f6368] mt-0.5">{description}</div>
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function SettingSection({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-medium text-[#202124]">{label}</div>
        {description && <div className="text-xs text-[#5f6368] mt-0.5">{description}</div>}
      </div>
      {children}
    </div>
  );
}

function PanelHeader({ title, subtitle, isPending }: { title: string; subtitle: string; isPending?: boolean }) {
  return (
    <div className="flex items-start justify-between pb-5 mb-6 border-b border-[#e0e0e0]">
      <div>
        <h3 className="text-lg font-semibold text-[#202124]">{title}</h3>
        <p className="text-sm text-[#5f6368] mt-0.5">{subtitle}</p>
      </div>
      {isPending && (
        <div className="flex items-center gap-1.5 text-xs text-[#5f6368] mt-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving…
        </div>
      )}
    </div>
  );
}

function useSettingsPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingUpdatesRef = useRef<Partial<GeneralSettings>>({});

  const settingsQuery = useQuery<GeneralSettings>({ queryKey: ["/api/settings"] });

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<GeneralSettings>) => {
      const res = await apiRequest("PUT", "/api/settings", updates);
      return res.json();
    },
    onSuccess: (data: GeneralSettings) => queryClient.setQueryData(["/api/settings"], data),
    onError: (err: Error) => toast({ title: "Failed to save setting", description: err.message, variant: "destructive" }),
  });

  const update = useCallback((updates: Partial<GeneralSettings>) => {
    queryClient.setQueryData(["/api/settings"], (old: GeneralSettings | undefined) => old ? { ...old, ...updates } : old);
    pendingUpdatesRef.current = { ...pendingUpdatesRef.current, ...updates };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const batch = { ...pendingUpdatesRef.current };
      pendingUpdatesRef.current = {};
      updateMutation.mutate(batch);
    }, 300);
  }, [queryClient, updateMutation]);

  return { s: settingsQuery.data, update, isPending: updateMutation.isPending };
}

const PILL = (active: boolean) =>
  `px-5 py-2 text-sm rounded-full border transition-all font-medium ${
    active ? "border-[#0b57d0] bg-[#e8f0fe] text-[#0b57d0]" : "border-[#dadce0] text-[#5f6368] hover:bg-[#f1f3f4]"
  }`;

const TOGGLE = (active: boolean) =>
  `w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${active ? "bg-[#0b57d0]" : "bg-[#dadce0]"}`;

// ─── Appearance panel ─────────────────────────────────────────────────────────

function AppearancePanel() {
  const { s, update, isPending } = useSettingsPanel();
  if (!s) return <div className="p-8 text-sm text-[#5f6368]">Loading…</div>;

  return (
    <div className="p-8 max-w-[700px] space-y-7">
      <PanelHeader title="Appearance" subtitle="Adjust how LocalMail looks and feels" isPending={isPending} />

      <SettingRow label="Dark mode" description="Switch between light and dark colour themes">
        <button onClick={() => update({ darkMode: !s.darkMode })} className={TOGGLE(!!s.darkMode)} data-testid="toggle-dark-mode">
          <div className={`w-4 h-4 bg-white rounded-full absolute top-1 shadow-sm transition-all ${s.darkMode ? "left-6" : "left-1"}`} />
        </button>
      </SettingRow>

      <Separator />

      <SettingSection label="Display density" description="Controls the vertical spacing between emails in the list view">
        <div className="flex gap-3 flex-wrap">
          {(["default", "comfortable", "compact"] as const).map(d => (
            <button key={d} onClick={() => update({ displayDensity: d })} className={PILL(s.displayDensity === d)} data-testid={`button-density-${d}`}>
              {d.charAt(0).toUpperCase() + d.slice(1)}
            </button>
          ))}
        </div>
        <p className="text-xs text-[#9aa0a6]">
          {s.displayDensity === "compact" ? "Compact: more emails fit on screen with tighter row height." :
           s.displayDensity === "comfortable" ? "Comfortable: larger rows with extra whitespace for easier reading." :
           "Default: balanced row height suitable for most screens."}
        </p>
      </SettingSection>

      <Separator />

      <SettingSection label="Time format" description="How timestamps appear throughout the app">
        <div className="flex gap-3 flex-wrap">
          {(["12h", "24h"] as const).map(cf => (
            <button key={cf} onClick={() => update({ clockFormat: cf })} className={PILL((s.clockFormat || "12h") === cf)} data-testid={`button-clock-${cf}`}>
              {cf === "12h" ? "12-hour  (1:30 PM)" : "24-hour  (13:30)"}
            </button>
          ))}
        </div>
      </SettingSection>

      <Separator />

      <SettingSection label="Emails per page" description="How many emails are shown before pagination kicks in">
        <div className="flex gap-3 flex-wrap">
          {([10, 20, 50, 100] as const).map(n => (
            <button key={n} onClick={() => update({ emailsPerPage: n })} className={PILL((s.emailsPerPage || 20) === n)} data-testid={`button-perpage-${n}`}>
              {n}
            </button>
          ))}
        </div>
      </SettingSection>

      <Separator />

      <SettingRow label="Conversation view" description="Group emails with the same subject into a single thread">
        <button onClick={() => update({ conversationView: !s.conversationView })} className={TOGGLE(!!s.conversationView)} data-testid="toggle-conversation-view">
          <div className={`w-4 h-4 bg-white rounded-full absolute top-1 shadow-sm transition-all ${s.conversationView ? "left-6" : "left-1"}`} />
        </button>
      </SettingRow>

      <SettingRow label="Show labels on emails" description="Display colour-coded label badges in the list and reading view">
        <button onClick={() => update({ showLabels: !s.showLabels })} className={TOGGLE(!!s.showLabels)} data-testid="toggle-show-labels">
          <div className={`w-4 h-4 bg-white rounded-full absolute top-1 shadow-sm transition-all ${s.showLabels ? "left-6" : "left-1"}`} />
        </button>
      </SettingRow>
    </div>
  );
}

// ─── Notifications panel ──────────────────────────────────────────────────────

function NotificationsPanel() {
  const { s, update, isPending } = useSettingsPanel();
  if (!s) return <div className="p-8 text-sm text-[#5f6368]">Loading…</div>;

  return (
    <div className="p-8 max-w-[700px] space-y-7">
      <PanelHeader title="Notifications" subtitle="Control how and when LocalMail alerts you to new activity" isPending={isPending} />

      <SettingSection label="Desktop notifications" description="Show a system pop-up when new emails arrive in your inbox">
        <SettingRow label="New mail notifications" description="Receive a desktop alert each time a new message lands">
          <Switch checked={!!s.notifyNewMail} onCheckedChange={(v) => update({ notifyNewMail: v })} data-testid="switch-notify-new-mail" />
        </SettingRow>

        {"Notification" in window && (
          <div className={`flex items-center justify-between gap-4 p-4 rounded-xl border mt-2 ${
            Notification.permission === "granted" ? "bg-green-50 border-green-200" :
            Notification.permission === "denied"  ? "bg-red-50 border-red-200" :
            "bg-amber-50 border-amber-200"
          }`}>
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center ${
                Notification.permission === "granted" ? "bg-green-100" : "bg-[#fce8e6]"
              }`}>
                {Notification.permission === "granted"
                  ? <Bell className="h-4 w-4 text-green-700" />
                  : <BellOff className="h-4 w-4 text-[#c5221f]" />}
              </div>
              <div>
                <p className="text-sm font-medium text-[#202124]">
                  Browser permission:{" "}
                  <span className={Notification.permission === "granted" ? "text-green-700" : Notification.permission === "denied" ? "text-[#c5221f]" : "text-amber-700"}>
                    {Notification.permission === "granted" ? "Allowed" : Notification.permission === "denied" ? "Blocked" : "Not yet asked"}
                  </span>
                </p>
                <p className="text-xs text-[#5f6368] mt-0.5">
                  {Notification.permission === "denied"
                    ? "Open your browser's site settings to unblock notifications."
                    : Notification.permission === "granted"
                    ? "Notifications are ready — they fire when new emails arrive."
                    : "Click Enable to grant permission for desktop alerts."}
                </p>
              </div>
            </div>
            {Notification.permission === "default" && (
              <Button size="sm" onClick={() => Notification.requestPermission()} data-testid="button-request-notification-permission">
                Enable
              </Button>
            )}
          </div>
        )}
      </SettingSection>
    </div>
  );
}

// ─── Vacation Reply panel ─────────────────────────────────────────────────────

function VacationPanel() {
  const { s, update, isPending } = useSettingsPanel();
  if (!s) return <div className="p-8 text-sm text-[#5f6368]">Loading…</div>;

  const inputCls = "w-full px-3 py-2.5 text-sm border border-[#dadce0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a73e8] focus:border-transparent bg-white";

  return (
    <div className="p-8 max-w-[700px] space-y-7">
      <PanelHeader title="Vacation Reply" subtitle="Automatically send a reply when you receive emails while away" isPending={isPending} />

      <SettingRow label="Enable vacation auto-reply" description="Sends a canned reply to every new sender while active">
        <Switch checked={!!s.vacationReplyEnabled} onCheckedChange={(v) => update({ vacationReplyEnabled: v })} data-testid="switch-vacation-enabled" />
      </SettingRow>

      {s.vacationReplyEnabled && (
        <div className="space-y-5 p-5 bg-[#f8f9fa] rounded-xl border border-[#e0e0e0]">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#5f6368] uppercase tracking-wide">Reply subject</label>
            <input
              type="text"
              value={s.vacationSubject || ""}
              onChange={(e) => update({ vacationSubject: e.target.value })}
              placeholder="Out of office"
              className={inputCls}
              data-testid="input-vacation-subject"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#5f6368] uppercase tracking-wide">Message body</label>
            <textarea
              value={s.vacationBody || ""}
              onChange={(e) => update({ vacationBody: e.target.value })}
              placeholder="I'm currently out of office and will reply when I return."
              rows={4}
              className={`${inputCls} resize-none`}
              data-testid="textarea-vacation-body"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#5f6368] uppercase tracking-wide">Start date (optional)</label>
              <input
                type="date"
                value={s.vacationStartDate ? s.vacationStartDate.split("T")[0] : ""}
                onChange={(e) => update({ vacationStartDate: e.target.value ? new Date(e.target.value).toISOString() : "" })}
                className={inputCls}
                data-testid="input-vacation-start"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#5f6368] uppercase tracking-wide">End date (optional)</label>
              <input
                type="date"
                value={s.vacationEndDate ? s.vacationEndDate.split("T")[0] : ""}
                onChange={(e) => update({ vacationEndDate: e.target.value ? new Date(e.target.value).toISOString() : "" })}
                className={inputCls}
                data-testid="input-vacation-end"
              />
            </div>
          </div>

          <p className="text-xs text-[#9aa0a6]">
            If dates are set, replies only fire within that window. Each unique sender gets at most one auto-reply per server session.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Composing panel ──────────────────────────────────────────────────────────

function SignatureEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const initialised = useRef(false);

  useEffect(() => {
    if (editorRef.current && !initialised.current) {
      editorRef.current.innerHTML = value || "";
      initialised.current = true;
    }
  }, [value]);

  const exec = (cmd: string, val?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val);
  };

  const handleLink = () => {
    const url = prompt("Enter URL:");
    if (url) exec("createLink", url.startsWith("http") ? url : `https://${url}`);
  };

  const handleInput = () => {
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };

  return (
    <div className="border border-[#dadce0] rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-[#1a73e8] focus-within:border-transparent bg-white">
      {/* Mini toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-[#e8eaed] bg-[#f8f9fa]">
        <button onMouseDown={e => { e.preventDefault(); exec("bold"); }} className="p-1.5 rounded hover:bg-[#e8eaed] text-[#5f6368]" title="Bold">
          <Bold className="w-3.5 h-3.5" />
        </button>
        <button onMouseDown={e => { e.preventDefault(); exec("italic"); }} className="p-1.5 rounded hover:bg-[#e8eaed] text-[#5f6368]" title="Italic">
          <Italic className="w-3.5 h-3.5" />
        </button>
        <button onMouseDown={e => { e.preventDefault(); exec("underline"); }} className="p-1.5 rounded hover:bg-[#e8eaed] text-[#5f6368]" title="Underline">
          <Underline className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-4 bg-[#dadce0] mx-1" />
        <button onMouseDown={e => { e.preventDefault(); exec("insertUnorderedList"); }} className="p-1.5 rounded hover:bg-[#e8eaed] text-[#5f6368]" title="Bullet list">
          <List className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-4 bg-[#dadce0] mx-1" />
        <button onMouseDown={e => { e.preventDefault(); handleLink(); }} className="p-1.5 rounded hover:bg-[#e8eaed] text-[#5f6368]" title="Insert link">
          <LinkIcon className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-4 bg-[#dadce0] mx-1" />
        <button onMouseDown={e => { e.preventDefault(); if (editorRef.current) { editorRef.current.innerHTML = ""; onChange(""); } }} className="p-1.5 rounded hover:bg-[#e8eaed] text-[#9aa0a6]" title="Clear signature">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        data-testid="editor-signature"
        data-placeholder="Best regards,&#10;Your Name"
        className="min-h-[110px] px-3 py-2.5 text-sm text-[#202124] outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-[#9aa0a6] empty:before:whitespace-pre"
      />
    </div>
  );
}

function ComposingPanel() {
  const { s, update, isPending } = useSettingsPanel();
  if (!s) return <div className="p-8 text-sm text-[#5f6368]">Loading…</div>;

  return (
    <div className="p-8 max-w-[700px] space-y-7">
      <PanelHeader title="Composing" subtitle="Customise how you write and send emails" isPending={isPending} />

      <SettingSection label="Default send account" description="Pre-selected when you open a new compose window">
        <DefaultSendAccountSetting value={s.defaultSendAccountId || ""} onChange={(id) => update({ defaultSendAccountId: id })} />
      </SettingSection>

      <Separator />

      <SettingSection label="Reply compose style" description="Choose how the compose window opens when you reply or forward an email">
        <div className="flex gap-3 flex-wrap">
          <button onClick={() => update({ replyStyle: "popout" })} className={PILL((s.replyStyle || "popout") === "popout")} data-testid="button-reply-style-popout">
            Floating window
          </button>
          <button onClick={() => update({ replyStyle: "inline" })} className={PILL((s.replyStyle || "popout") === "inline")} data-testid="button-reply-style-inline">
            Inline (below email)
          </button>
        </div>
      </SettingSection>

      <Separator />

      <SettingSection label="Send cancellation window" description="Brief delay before an email is actually sent — lets you undo if needed">
        <div className="flex gap-3 flex-wrap">
          {([0, 5, 10, 30] as const).map(secs => (
            <button key={secs} onClick={() => update({ sendCancellation: secs })} className={PILL((s.sendCancellation ?? 5) === secs)} data-testid={`button-send-cancel-${secs}`}>
              {secs === 0 ? "Off" : `${secs}s`}
            </button>
          ))}
        </div>
      </SettingSection>

      <Separator />

      <SettingSection label="Email signature" description="Automatically appended to the bottom of every new email you write">
        <SignatureEditor value={s.signature || ""} onChange={(html) => update({ signature: html })} />
      </SettingSection>
    </div>
  );
}

// ─── Storage panel ────────────────────────────────────────────────────────────

function StoragePanel() {
  const { s, update, isPending } = useSettingsPanel();
  if (!s) return <div className="p-8 text-sm text-[#5f6368]">Loading…</div>;

  return (
    <div className="p-8 max-w-[700px] space-y-7">
      <PanelHeader title="Storage & Retention" subtitle="Control how long deleted and spam emails are kept before permanent removal" isPending={isPending} />

      <SettingSection label="Trash retention" description="Emails moved to Trash are permanently deleted after this period">
        <div className="flex gap-3 flex-wrap">
          {[30, 60, 90, 180].map(days => (
            <button key={days} onClick={() => update({ trashRetentionDays: days })} className={PILL((s.trashRetentionDays || 30) === days)} data-testid={`button-trash-${days}`}>
              {days} days
            </button>
          ))}
        </div>
        <p className="text-xs text-[#9aa0a6]">Trashed emails older than {s.trashRetentionDays || 30} days are removed permanently on the next cleanup cycle.</p>
      </SettingSection>

      <Separator />

      <SettingSection label="Spam retention" description="Emails in Spam are automatically purged after this period">
        <div className="flex gap-3 flex-wrap">
          {[7, 30, 60, 90].map(days => (
            <button key={days} onClick={() => update({ spamRetentionDays: days })} className={PILL((s.spamRetentionDays || 30) === days)} data-testid={`button-spam-${days}`}>
              {days} days
            </button>
          ))}
        </div>
        <p className="text-xs text-[#9aa0a6]">Spam older than {s.spamRetentionDays || 30} days is removed permanently on the next cleanup cycle.</p>
      </SettingSection>
    </div>
  );
}

function LabelRow({ label, colors, onUpdate, onDelete }: { label: EmailLabel; colors: string[]; onUpdate: (id: string, updates: Partial<EmailLabel>) => void; onDelete: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(label.name);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const customColorRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    if (editName.trim() && editName !== label.name) {
      onUpdate(label.id, { name: editName.trim() });
    }
    setEditing(false);
  };

  const handleColorChange = (color: string) => {
    onUpdate(label.id, { color });
    setShowColorPicker(false);
  };

  return (
    <div className="flex items-center justify-between p-2.5 border border-[#dadce0] rounded-lg bg-white group">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="relative">
          <button
            onClick={() => setShowColorPicker(!showColorPicker)}
            className="w-5 h-5 rounded-sm flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-[#1a73e8] transition-all"
            style={{ backgroundColor: label.color }}
            title="Change color"
            data-testid={`button-label-color-${label.id}`}
          />
          {showColorPicker && (
            <div className="absolute left-0 top-7 z-20 bg-white border border-[#dadce0] rounded-lg shadow-lg p-2 w-[210px]">
              <div className="flex flex-wrap gap-1.5">
                {colors.map(c => (
                  <button
                    key={c}
                    onClick={() => handleColorChange(c)}
                    className={`w-6 h-6 rounded-full transition-all ${label.color === c ? "ring-2 ring-offset-1 ring-[#1a73e8]" : "hover:scale-110"}`}
                    style={{ backgroundColor: c }}
                    data-testid={`button-label-pick-color-${c}`}
                  />
                ))}
              </div>
              <div className="mt-2 pt-2 border-t border-[#e0e0e0] flex items-center gap-2">
                <div
                  className="w-6 h-6 rounded-full border-2 border-dashed border-[#dadce0] flex items-center justify-center cursor-pointer hover:border-[#1a73e8] transition-colors overflow-hidden relative"
                  onClick={() => customColorRef.current?.click()}
                  title="Pick custom color"
                  data-testid="button-label-custom-color"
                >
                  <Plus className="h-3 w-3 text-[#5f6368]" />
                  <input
                    ref={customColorRef}
                    type="color"
                    defaultValue={label.color}
                    onChange={(e) => {
                      onUpdate(label.id, { color: e.target.value });
                    }}
                    onBlur={() => setShowColorPicker(false)}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                </div>
                <span className="text-xs text-[#5f6368]">Custom color</span>
              </div>
            </div>
          )}
        </div>
        {editing ? (
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleSave}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") { setEditName(label.name); setEditing(false); } }}
            className="text-sm text-[#202124] outline-none border-b border-[#0b57d0] bg-transparent flex-1 min-w-0"
            autoFocus
            data-testid={`input-label-rename-${label.id}`}
          />
        ) : (
          <span
            className="text-sm text-[#202124] cursor-pointer hover:text-[#0b57d0] truncate"
            onClick={() => { setEditName(label.name); setEditing(true); }}
            title="Click to rename"
            data-testid={`text-label-name-${label.id}`}
          >
            {label.name}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => { setEditName(label.name); setEditing(true); }}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[#f1f3f4] text-[#5f6368] transition-all"
          title="Rename"
          data-testid={`button-rename-label-${label.id}`}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onDelete(label.id)}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[#f1f3f4] text-[#5f6368] hover:text-red-500 transition-all"
          data-testid={`button-delete-label-${label.id}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function LabelsSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const labelsQuery = useQuery<EmailLabel[]>({
    queryKey: ["/api/labels"],
  });

  const labels = labelsQuery.data || [];

  const COLORS = ["#1a73e8", "#16a765", "#f5a623", "#a142f4", "#e37400", "#e91e63", "#4caf50", "#00bcd4", "#795548", "#607d8b"];

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#1a73e8");

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/labels", { name: newName, color: newColor });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labels"] });
      toast({ title: "Label created" });
      setNewName(""); setNewColor("#1a73e8");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create label", description: err.message, variant: "destructive" });
    },
  });

  const updateLabelMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<EmailLabel> }) => {
      const res = await apiRequest("PATCH", `/api/labels/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labels"] });
      toast({ title: "Label updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update label", description: err.message, variant: "destructive" });
    },
  });

  const deleteLabelMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/labels/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labels"] });
      toast({ title: "Label deleted" });
    },
  });

  const handleUpdate = (id: string, updates: Partial<EmailLabel>) => {
    updateLabelMutation.mutate({ id, updates });
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-base font-medium text-[#202124] mb-1">Labels</h3>
        <p className="text-xs text-[#5f6368]">Manage your labels to organize your mail. Click a label name to rename it, or click the color to change it.</p>
      </div>

      {/* Existing labels */}
      <div className="space-y-2">
        {labels.map(label => (
          <LabelRow
            key={label.id}
            label={label}
            colors={COLORS}
            onUpdate={handleUpdate}
            onDelete={(id) => deleteLabelMutation.mutate(id)}
          />
        ))}
      </div>

      <Separator />

      {/* Create new label */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-[#202124]">Create new label</h4>
        <div className="space-y-1.5">
          <Label className="text-xs text-[#5f6368]">Name</Label>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Label name" data-testid="input-settings-label-name" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-[#5f6368]">Color</Label>
          <div className="flex flex-wrap gap-2 items-center">
            {COLORS.map(c => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                className={`w-7 h-7 rounded-full transition-all ${newColor === c ? "ring-2 ring-offset-2 ring-[#1a73e8]" : ""}`}
                style={{ backgroundColor: c }}
              />
            ))}
            <div className="relative w-7 h-7 rounded-full border-2 border-dashed border-[#dadce0] flex items-center justify-center cursor-pointer hover:border-[#1a73e8] transition-colors overflow-hidden" title="Pick custom color" data-testid="button-create-label-custom-color">
              <Plus className="h-3.5 w-3.5 text-[#5f6368]" />
              <input
                type="color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
            </div>
            {!COLORS.includes(newColor) && (
              <div className={`w-7 h-7 rounded-full ring-2 ring-offset-2 ring-[#1a73e8]`} style={{ backgroundColor: newColor }} title={`Custom: ${newColor}`} />
            )}
          </div>
        </div>
        <Button
          onClick={() => createMutation.mutate()}
          disabled={!newName || createMutation.isPending}
          className="rounded-full px-6"
          style={{ backgroundColor: "#0b57d0" }}
          data-testid="button-settings-create-label"
        >
          {createMutation.isPending ? "Creating..." : "Create Label"}
        </Button>
      </div>
    </div>
  );
}

function BackupSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<"s3" | "azure" | "gcp">("s3");
  const [enabled, setEnabled] = useState(false);
  const [schedule, setSchedule] = useState<"manual" | "daily" | "weekly" | "monthly">("manual");
  const [s3Bucket, setS3Bucket] = useState("");
  const [s3Region, setS3Region] = useState("us-east-1");
  const [s3AccessKeyId, setS3AccessKeyId] = useState("");
  const [s3SecretAccessKey, setS3SecretAccessKey] = useState("");
  const [s3Prefix, setS3Prefix] = useState("localmail-backups/");
  const [azureConnectionString, setAzureConnectionString] = useState("");
  const [azureContainerName, setAzureContainerName] = useState("");
  const [azurePrefix, setAzurePrefix] = useState("localmail-backups/");
  const [gcpBucket, setGcpBucket] = useState("");
  const [gcpProjectId, setGcpProjectId] = useState("");
  const [gcpKeyJson, setGcpKeyJson] = useState("");
  const [gcpPrefix, setGcpPrefix] = useState("localmail-backups/");
  const [testing, setTesting] = useState(false);
  const [backing, setBacking] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [localDownloading, setLocalDownloading] = useState(false);
  const [localRestoring, setLocalRestoring] = useState(false);
  const localFileRef = useRef<HTMLInputElement>(null);

  const configQuery = useQuery<BackupConfig | null>({
    queryKey: ["/api/backup/config"],
  });

  const backupsQuery = useQuery<{ name: string; size: number; lastModified: string }[]>({
    queryKey: ["/api/backup/list"],
    enabled: loaded,
  });

  useEffect(() => {
    if (configQuery.data && !loaded) {
      const c = configQuery.data;
      setProvider(c.provider);
      setEnabled(c.enabled);
      setSchedule(c.schedule);
      if (c.s3) {
        setS3Bucket(c.s3.bucket);
        setS3Region(c.s3.region);
        setS3AccessKeyId(c.s3.accessKeyId);
        setS3Prefix(c.s3.prefix);
      }
      if (c.azure) {
        setAzureContainerName(c.azure.containerName);
        setAzurePrefix(c.azure.prefix);
      }
      if (c.gcp) {
        setGcpBucket(c.gcp.bucket);
        setGcpProjectId(c.gcp.projectId);
        setGcpPrefix(c.gcp.prefix);
      }
      setLoaded(true);
    } else if (configQuery.data === null && !loaded) {
      setLoaded(true);
    }
  }, [configQuery.data, loaded]);

  const buildConfig = (): any => {
    const config: any = { provider, enabled, schedule };
    if (provider === "s3") {
      config.s3 = { bucket: s3Bucket, region: s3Region, accessKeyId: s3AccessKeyId, secretAccessKey: s3SecretAccessKey || "UNCHANGED", prefix: s3Prefix };
    } else if (provider === "azure") {
      config.azure = { connectionString: azureConnectionString || "UNCHANGED", containerName: azureContainerName, prefix: azurePrefix };
    } else if (provider === "gcp") {
      config.gcp = { bucket: gcpBucket, projectId: gcpProjectId, keyJson: gcpKeyJson || "UNCHANGED", prefix: gcpPrefix };
    }
    return config;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiRequest("POST", "/api/backup/config", buildConfig());
      toast({ title: "Backup configuration saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/backup/config"] });
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await apiRequest("POST", "/api/backup/test");
      const data = await res.json();
      toast({ title: data.success ? "Connection successful" : "Connection failed", description: data.message, variant: data.success ? "default" : "destructive" });
    } catch (err: any) {
      toast({ title: "Test failed", description: err.message, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  const handleBackupNow = async () => {
    setBacking(true);
    try {
      const res = await apiRequest("POST", "/api/backup/run");
      const data = await res.json();
      toast({ title: data.success ? "Backup completed" : "Backup failed", description: data.message, variant: data.success ? "default" : "destructive" });
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ["/api/backup/list"] });
        queryClient.invalidateQueries({ queryKey: ["/api/backup/config"] });
      }
    } catch (err: any) {
      toast({ title: "Backup failed", description: err.message, variant: "destructive" });
    } finally {
      setBacking(false);
    }
  };

  const handleRestore = async (fileName: string) => {
    if (!confirm(`Are you sure you want to restore from "${fileName}"? This will replace all your current emails and settings with the backup data.`)) return;
    setRestoring(true);
    try {
      const res = await apiRequest("POST", "/api/backup/restore", { fileName });
      const data = await res.json();
      toast({ title: data.success ? "Restore completed" : "Restore failed", description: data.message, variant: data.success ? "default" : "destructive" });
    } catch (err: any) {
      toast({ title: "Restore failed", description: err.message, variant: "destructive" });
    } finally {
      setRestoring(false);
    }
  };

  const handleLocalDownload = async () => {
    setLocalDownloading(true);
    try {
      const res = await fetch("/api/backup/local/download", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to download backup");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = res.headers.get("Content-Disposition");
      const match = disposition?.match(/filename="(.+)"/);
      a.download = match?.[1] || "localmail-backup.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Backup downloaded successfully" });
    } catch (err: any) {
      toast({ title: "Download failed", description: err.message, variant: "destructive" });
    } finally {
      setLocalDownloading(false);
    }
  };

  const handleLocalRestore = async (file: File) => {
    if (!confirm(`Are you sure you want to restore from "${file.name}"? This will replace all your current emails and settings with the backup data.`)) return;
    setLocalRestoring(true);
    try {
      const formData = new FormData();
      formData.append("backup", file);
      const res = await fetch("/api/backup/local/restore", { method: "POST", body: formData, credentials: "include" });
      const data = await res.json();
      toast({ title: data.success ? "Restore completed" : "Restore failed", description: data.message, variant: data.success ? "default" : "destructive" });
    } catch (err: any) {
      toast({ title: "Restore failed", description: err.message, variant: "destructive" });
    } finally {
      setLocalRestoring(false);
      if (localFileRef.current) localFileRef.current.value = "";
    }
  };

  const lastBackup = configQuery.data?.lastBackup;
  const lastStatus = configQuery.data?.lastBackupStatus;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-base font-medium text-[#202124] mb-1">Local Backup</h3>
        <p className="text-sm text-[#5f6368]">Download a backup file to your computer or restore from a local file</p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Button onClick={handleLocalDownload} disabled={localDownloading} className="bg-[#1a73e8] text-white hover:bg-[#1557b0]" data-testid="button-local-download">
          {localDownloading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Download className="w-4 h-4 mr-2" />}
          Download Backup
        </Button>
        <div className="relative">
          <input
            ref={localFileRef}
            type="file"
            accept=".zip"
            className="hidden"
            data-testid="input-local-restore-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleLocalRestore(file);
            }}
          />
          <Button
            onClick={() => localFileRef.current?.click()}
            disabled={localRestoring}
            variant="outline"
            data-testid="button-local-restore"
          >
            {localRestoring ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RotateCcw className="w-4 h-4 mr-2" />}
            Restore from File
          </Button>
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="text-base font-medium text-[#202124] mb-1">Cloud Backup</h3>
        <p className="text-sm text-[#5f6368]">Back up your encrypted emails to cloud storage</p>
      </div>

      <div className="space-y-4">
        <div>
          <Label className="text-sm font-medium">Cloud Provider</Label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as any)}
            className="w-full mt-1 h-9 rounded-md border border-[#dadce0] bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a73e8]"
            data-testid="select-backup-provider"
          >
            <option value="s3">Amazon S3</option>
            <option value="azure">Azure Blob Storage</option>
            <option value="gcp">Google Cloud Storage</option>
          </select>
        </div>

        {provider === "s3" && (
          <div className="space-y-3 p-4 bg-[#f6f8fc] rounded-lg border border-[#e0e0e0]">
            <h4 className="text-sm font-medium text-[#202124]">Amazon S3 Configuration</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Bucket Name</Label>
                <Input value={s3Bucket} onChange={(e) => setS3Bucket(e.target.value)} placeholder="my-backup-bucket" className="mt-1" data-testid="input-s3-bucket" />
              </div>
              <div>
                <Label className="text-xs">Region</Label>
                <Input value={s3Region} onChange={(e) => setS3Region(e.target.value)} placeholder="us-east-1" className="mt-1" data-testid="input-s3-region" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Access Key ID</Label>
              <Input value={s3AccessKeyId} onChange={(e) => setS3AccessKeyId(e.target.value)} placeholder="AKIAIOSFODNN7EXAMPLE" className="mt-1" data-testid="input-s3-access-key" />
            </div>
            <div>
              <Label className="text-xs">Secret Access Key</Label>
              <Input type="password" value={s3SecretAccessKey} onChange={(e) => setS3SecretAccessKey(e.target.value)} placeholder="Enter secret access key" className="mt-1" data-testid="input-s3-secret-key" />
            </div>
            <div>
              <Label className="text-xs">Path Prefix</Label>
              <Input value={s3Prefix} onChange={(e) => setS3Prefix(e.target.value)} placeholder="localmail-backups/" className="mt-1" data-testid="input-s3-prefix" />
            </div>
          </div>
        )}

        {provider === "azure" && (
          <div className="space-y-3 p-4 bg-[#f6f8fc] rounded-lg border border-[#e0e0e0]">
            <h4 className="text-sm font-medium text-[#202124]">Azure Blob Storage Configuration</h4>
            <div>
              <Label className="text-xs">Connection String</Label>
              <Input type="password" value={azureConnectionString} onChange={(e) => setAzureConnectionString(e.target.value)} placeholder="DefaultEndpointsProtocol=https;..." className="mt-1" data-testid="input-azure-connection" />
            </div>
            <div>
              <Label className="text-xs">Container Name</Label>
              <Input value={azureContainerName} onChange={(e) => setAzureContainerName(e.target.value)} placeholder="localmail-backups" className="mt-1" data-testid="input-azure-container" />
            </div>
            <div>
              <Label className="text-xs">Path Prefix</Label>
              <Input value={azurePrefix} onChange={(e) => setAzurePrefix(e.target.value)} placeholder="localmail-backups/" className="mt-1" data-testid="input-azure-prefix" />
            </div>
          </div>
        )}

        {provider === "gcp" && (
          <div className="space-y-3 p-4 bg-[#f6f8fc] rounded-lg border border-[#e0e0e0]">
            <h4 className="text-sm font-medium text-[#202124]">Google Cloud Storage Configuration</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Bucket Name</Label>
                <Input value={gcpBucket} onChange={(e) => setGcpBucket(e.target.value)} placeholder="my-backup-bucket" className="mt-1" data-testid="input-gcp-bucket" />
              </div>
              <div>
                <Label className="text-xs">Project ID</Label>
                <Input value={gcpProjectId} onChange={(e) => setGcpProjectId(e.target.value)} placeholder="my-project-123" className="mt-1" data-testid="input-gcp-project" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Service Account Key (JSON)</Label>
              <Textarea value={gcpKeyJson} onChange={(e) => setGcpKeyJson(e.target.value)} placeholder='Paste service account JSON key...' className="mt-1 font-mono text-xs" rows={4} data-testid="input-gcp-key" />
            </div>
            <div>
              <Label className="text-xs">Path Prefix</Label>
              <Input value={gcpPrefix} onChange={(e) => setGcpPrefix(e.target.value)} placeholder="localmail-backups/" className="mt-1" data-testid="input-gcp-prefix" />
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="w-4 h-4 accent-[#1a73e8]" data-testid="checkbox-backup-enabled" />
            <Label className="text-sm">Enable scheduled backups</Label>
          </div>
          {enabled && (
            <select
              value={schedule}
              onChange={(e) => setSchedule(e.target.value as any)}
              className="h-8 rounded-md border border-[#dadce0] bg-white px-2 text-sm"
              data-testid="select-backup-schedule"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          )}
        </div>

        <div className="flex items-center gap-2 pt-2">
          <Button onClick={handleSave} disabled={saving} className="bg-[#1a73e8] text-white hover:bg-[#1557b0]" data-testid="button-backup-save">
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Save Configuration
          </Button>
          <Button onClick={handleTest} disabled={testing} variant="outline" data-testid="button-backup-test">
            {testing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
            Test Connection
          </Button>
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-medium text-[#202124]">Manual Backup</h4>
            {lastBackup && (
              <p className="text-xs text-[#5f6368] mt-0.5">
                Last backup: {format(new Date(lastBackup), "MMM d, yyyy h:mm a")}
                {lastStatus && (
                  <span className={`ml-2 ${lastStatus === "success" ? "text-green-600" : "text-red-600"}`}>
                    ({lastStatus})
                  </span>
                )}
              </p>
            )}
          </div>
          <Button onClick={handleBackupNow} disabled={backing} className="bg-[#1a73e8] text-white hover:bg-[#1557b0]" data-testid="button-backup-now">
            {backing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CloudUpload className="w-4 h-4 mr-2" />}
            Backup Now
          </Button>
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        <h4 className="text-sm font-medium text-[#202124]">Backup History & Restore</h4>
        {backupsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-[#5f6368]">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading backups...
          </div>
        ) : (backupsQuery.data || []).length === 0 ? (
          <p className="text-sm text-[#5f6368]">No backups found. Run a backup first or check your configuration.</p>
        ) : (
          <div className="space-y-2 max-h-[200px] overflow-y-auto">
            {(backupsQuery.data || []).map((backup) => (
              <div key={backup.name} className="flex items-center justify-between p-3 bg-[#f6f8fc] rounded-lg border border-[#e0e0e0]">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[#202124] truncate">{backup.name}</p>
                  <p className="text-xs text-[#5f6368]">
                    {(backup.size / 1024 / 1024).toFixed(2)} MB — {backup.lastModified ? format(new Date(backup.lastModified), "MMM d, yyyy h:mm a") : ""}
                  </p>
                </div>
                <Button
                  onClick={() => handleRestore(backup.name)}
                  disabled={restoring}
                  variant="outline"
                  size="sm"
                  className="ml-3 flex-shrink-0"
                  data-testid={`button-restore-${backup.name}`}
                >
                  {restoring ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RotateCcw className="w-3 h-3 mr-1" />}
                  Restore
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const FOLDER_COLORS = ["#5f6368", "#1a73e8", "#16a765", "#f5a623", "#a142f4", "#e37400", "#e91e63", "#4caf50", "#00bcd4", "#795548"];

function FolderRow({ folder, onUpdate, onDelete }: { folder: CustomFolder; onUpdate: (id: string, updates: Partial<CustomFolder>) => void; onDelete: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(folder.name);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const customColorRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    if (editName.trim() && editName !== folder.name) {
      onUpdate(folder.id, { name: editName.trim() });
    }
    setEditing(false);
  };

  const handleColorChange = (color: string) => {
    onUpdate(folder.id, { color });
    setShowColorPicker(false);
  };

  return (
    <div className="flex items-center justify-between p-2.5 border border-[#dadce0] rounded-lg bg-white group">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="relative">
          <button
            onClick={() => setShowColorPicker(!showColorPicker)}
            className="w-5 h-5 rounded-sm flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-[#1a73e8] transition-all flex items-center justify-center"
            style={{ backgroundColor: folder.color }}
            title="Change color"
            data-testid={`button-folder-color-${folder.id}`}
          >
            <Folder className="w-3 h-3 text-white opacity-70" />
          </button>
          {showColorPicker && (
            <div className="absolute left-0 top-7 z-20 bg-white border border-[#dadce0] rounded-lg shadow-lg p-2 w-[210px]">
              <div className="flex flex-wrap gap-1.5">
                {FOLDER_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => handleColorChange(c)}
                    className={`w-6 h-6 rounded-full transition-all ${folder.color === c ? "ring-2 ring-offset-1 ring-[#1a73e8]" : "hover:scale-110"}`}
                    style={{ backgroundColor: c }}
                    data-testid={`button-folder-pick-color-${c}`}
                  />
                ))}
              </div>
              <div className="mt-2 pt-2 border-t border-[#e0e0e0] flex items-center gap-2">
                <div
                  className="w-6 h-6 rounded-full border-2 border-dashed border-[#dadce0] flex items-center justify-center cursor-pointer hover:border-[#1a73e8] transition-colors overflow-hidden relative"
                  onClick={() => customColorRef.current?.click()}
                  title="Pick custom color"
                  data-testid="button-folder-custom-color"
                >
                  <Plus className="h-3 w-3 text-[#5f6368]" />
                  <input
                    ref={customColorRef}
                    type="color"
                    defaultValue={folder.color}
                    onChange={(e) => onUpdate(folder.id, { color: e.target.value })}
                    onBlur={() => setShowColorPicker(false)}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                </div>
                <span className="text-xs text-[#5f6368]">Custom color</span>
              </div>
            </div>
          )}
        </div>
        {editing ? (
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleSave}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") { setEditName(folder.name); setEditing(false); } }}
            className="text-sm text-[#202124] outline-none border-b border-[#0b57d0] bg-transparent flex-1 min-w-0"
            autoFocus
            data-testid={`input-folder-rename-${folder.id}`}
          />
        ) : (
          <span
            className="text-sm text-[#202124] cursor-pointer hover:text-[#0b57d0] truncate"
            onClick={() => { setEditName(folder.name); setEditing(true); }}
            data-testid={`text-folder-name-${folder.id}`}
          >
            {folder.name}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 ml-2">
        {!editing && (
          <>
            <button onClick={() => { setEditName(folder.name); setEditing(true); }} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[#f1f3f4] text-[#5f6368]" title="Rename"><Pencil className="h-3.5 w-3.5" /></button>
            <button onClick={() => onDelete(folder.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[#f1f3f4] text-[#5f6368] hover:text-red-500" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
          </>
        )}
      </div>
    </div>
  );
}

function FoldersSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const foldersQuery = useQuery<CustomFolder[]>({ queryKey: ["/api/custom-folders"] });
  const folders = foldersQuery.data || [];

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#1a73e8");
  const [showNewColorPicker, setShowNewColorPicker] = useState(false);
  const newCustomColorRef = useRef<HTMLInputElement>(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/custom-folders", { name: newName, color: newColor });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-folders"] });
      toast({ title: "Folder created" });
      setNewName(""); setNewColor("#1a73e8");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create folder", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<CustomFolder> }) => {
      const res = await apiRequest("PATCH", `/api/custom-folders/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-folders"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/custom-folders/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-folders"] });
      toast({ title: "Folder deleted" });
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-base font-medium text-[#202124] mb-1">Custom Folders</h3>
        <p className="text-xs text-[#5f6368]">Create custom folders to organize your emails. Click the colour swatch to change a folder's colour. Drag and drop emails into folders from the sidebar.</p>
      </div>

      <div className="space-y-2">
        {folders.map(f => (
          <FolderRow
            key={f.id}
            folder={f}
            onUpdate={(id, updates) => updateMutation.mutate({ id, updates })}
            onDelete={(id) => deleteMutation.mutate(id)}
          />
        ))}
        {folders.length === 0 && (
          <p className="text-sm text-[#5f6368] py-4 text-center">No custom folders yet. Create one below.</p>
        )}
      </div>

      <Separator />

      <div className="space-y-3">
        <h4 className="text-sm font-medium text-[#202124]">Create new folder</h4>
        <div className="space-y-1.5">
          <Label className="text-xs text-[#5f6368]">Name</Label>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Folder name" onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) createMutation.mutate(); }} data-testid="input-folder-name" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-[#5f6368]">Color</Label>
          <div className="flex items-center gap-2 flex-wrap">
            {FOLDER_COLORS.map(c => (
              <button
                key={c}
                onClick={() => { setNewColor(c); setShowNewColorPicker(false); }}
                className={`w-7 h-7 rounded-full transition-all ${newColor === c ? "ring-2 ring-offset-2 ring-[#1a73e8]" : "hover:scale-110"}`}
                style={{ backgroundColor: c }}
                data-testid={`button-new-folder-color-${c}`}
              />
            ))}
            <div className="relative">
              <div
                className="w-7 h-7 rounded-full border-2 border-dashed border-[#dadce0] flex items-center justify-center cursor-pointer hover:border-[#1a73e8] transition-colors overflow-hidden relative"
                onClick={() => newCustomColorRef.current?.click()}
                title="Pick custom color"
                data-testid="button-new-folder-custom-color"
                style={!FOLDER_COLORS.includes(newColor) ? { backgroundColor: newColor, borderStyle: "solid" } : {}}
              >
                {FOLDER_COLORS.includes(newColor) ? <Plus className="h-3.5 w-3.5 text-[#5f6368]" /> : null}
                <input
                  ref={newCustomColorRef}
                  type="color"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-sm flex items-center justify-center" style={{ backgroundColor: newColor }}>
            <Folder className="w-4 h-4 text-white opacity-80" />
          </div>
          <Button onClick={() => createMutation.mutate()} disabled={!newName.trim() || createMutation.isPending} className="rounded-full px-6" style={{ backgroundColor: "#0b57d0" }} data-testid="button-create-folder">
            {createMutation.isPending ? "Creating..." : "Create Folder"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RulesSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const rulesQuery = useQuery<EmailRule[]>({ queryKey: ["/api/rules"] });
  const labelsQuery = useQuery<EmailLabel[]>({ queryKey: ["/api/labels"] });
  const foldersQuery = useQuery<CustomFolder[]>({ queryKey: ["/api/custom-folders"] });
  const rules = rulesQuery.data || [];
  const labels = labelsQuery.data || [];
  const customFolders = foldersQuery.data || [];

  const SYSTEM_FOLDERS = [
    { id: "inbox", name: "Inbox" },
    { id: "archive", name: "Archive" },
    { id: "spam", name: "Spam" },
    { id: "trash", name: "Trash" },
  ];
  const allFolders = [...SYSTEM_FOLDERS, ...customFolders.map(f => ({ id: `custom:${f.id}`, name: f.name }))];

  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<EmailRule | null>(null);
  const [ruleName, setRuleName] = useState("");
  const [conditions, setConditions] = useState<EmailRuleCondition[]>([{ field: "from", match: "contains", value: "" }]);
  const [conditionLogic, setConditionLogic] = useState<"all" | "any">("all");
  const [action, setAction] = useState<"move" | "label" | "star" | "markRead">("move");
  const [targetFolder, setTargetFolder] = useState("inbox");
  const [targetLabel, setTargetLabel] = useState("");

  const resetForm = () => {
    setRuleName(""); setConditions([{ field: "from", match: "contains", value: "" }]); setConditionLogic("all"); setAction("move"); setTargetFolder("inbox"); setTargetLabel(""); setEditingRule(null); setShowForm(false);
  };

  const openEdit = (rule: EmailRule) => {
    setEditingRule(rule);
    setRuleName(rule.name);
    setConditions(rule.conditions);
    setConditionLogic(rule.conditionLogic || "all");
    setAction(rule.action);
    setTargetFolder(rule.targetFolder || "inbox");
    setTargetLabel(rule.targetLabel || "");
    setShowForm(true);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const body = { name: ruleName, enabled: true, conditions, conditionLogic, action, targetFolder: action === "move" ? targetFolder : undefined, targetLabel: action === "label" ? targetLabel : undefined };
      const res = await apiRequest("POST", "/api/rules", body);
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/rules"] }); toast({ title: "Rule created" }); resetForm(); },
    onError: (err: Error) => { toast({ title: "Failed to create rule", description: err.message, variant: "destructive" }); },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<EmailRule> }) => {
      const res = await apiRequest("PATCH", `/api/rules/${id}`, updates);
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/rules"] }); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/rules/${id}`);
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/rules"] }); toast({ title: "Rule deleted" }); },
  });

  const runAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/rules/run-all");
      return res.json();
    },
    onSuccess: (data: { matched: number; total: number }) => {
      queryClient.invalidateQueries({ predicate: (query) => (query.queryKey[0] as string)?.startsWith("/api/emails") });
      toast({ title: "Rules applied", description: `${data.matched} of ${data.total} emails matched and updated` });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to run rules", description: err.message, variant: "destructive" });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = { name: ruleName, enabled: editingRule?.enabled ?? true, conditions, conditionLogic, action, targetFolder: action === "move" ? targetFolder : undefined, targetLabel: action === "label" ? targetLabel : undefined };
      const res = await apiRequest("PATCH", `/api/rules/${editingRule!.id}`, body);
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/rules"] }); toast({ title: "Rule updated" }); resetForm(); },
  });

  const addCondition = () => setConditions([...conditions, { field: "from", match: "contains", value: "" }]);
  const removeCondition = (i: number) => setConditions(conditions.filter((_, idx) => idx !== i));
  const updateCondition = (i: number, updates: Partial<EmailRuleCondition>) => setConditions(conditions.map((c, idx) => idx === i ? { ...c, ...updates } : c));

  const canSave = ruleName.trim() && conditions.every(c => c.value.trim()) && (action !== "move" || targetFolder) && (action !== "label" || targetLabel);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-medium text-[#202124] mb-1">Email Rules</h3>
          <p className="text-xs text-[#5f6368]">Automatically sort incoming emails by sender, subject, or recipient. Rules are applied when new mail is fetched.</p>
        </div>
        {!showForm && (
          <div className="flex gap-2">
            <Button onClick={() => runAllMutation.mutate()} disabled={runAllMutation.isPending || rules.length === 0} variant="outline" className="rounded-full px-4 text-sm" data-testid="button-run-rules">
              {runAllMutation.isPending ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Running...</> : <><RefreshCw className="w-4 h-4 mr-1" /> Run rules now</>}
            </Button>
            <Button onClick={() => setShowForm(true)} className="rounded-full px-4 text-sm" style={{ backgroundColor: "#0b57d0" }} data-testid="button-create-rule">
              <Plus className="w-4 h-4 mr-1" /> New Rule
            </Button>
          </div>
        )}
      </div>

      {showForm && (
        <div className="border border-[#dadce0] rounded-lg p-4 space-y-4 bg-[#fafbfd]">
          <h4 className="text-sm font-medium text-[#202124]">{editingRule ? "Edit Rule" : "New Rule"}</h4>
          <div className="space-y-1.5">
            <Label className="text-xs text-[#5f6368]">Rule name</Label>
            <Input value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder="e.g. Amazon orders to Shopping" data-testid="input-rule-name" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-[#5f6368]">When</Label>
              <select value={conditionLogic} onChange={(e) => setConditionLogic(e.target.value as "all" | "any")} className="text-xs border border-[#dadce0] rounded px-2 py-1">
                <option value="all">ALL conditions match</option>
                <option value="any">ANY condition matches</option>
              </select>
            </div>
            {conditions.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <select value={c.field} onChange={(e) => updateCondition(i, { field: e.target.value as "from" | "subject" | "to" })} className="text-sm border border-[#dadce0] rounded px-2 py-1.5 bg-white" data-testid={`select-rule-field-${i}`}>
                  <option value="from">From</option>
                  <option value="subject">Subject</option>
                  <option value="to">To</option>
                </select>
                <select value={c.match} onChange={(e) => updateCondition(i, { match: e.target.value as "contains" | "equals" | "startsWith" | "endsWith" })} className="text-sm border border-[#dadce0] rounded px-2 py-1.5 bg-white" data-testid={`select-rule-match-${i}`}>
                  <option value="contains">contains</option>
                  <option value="equals">equals</option>
                  <option value="startsWith">starts with</option>
                  <option value="endsWith">ends with</option>
                </select>
                <Input value={c.value} onChange={(e) => updateCondition(i, { value: e.target.value })} placeholder="Value..." className="flex-1 h-8 text-sm" data-testid={`input-rule-value-${i}`} />
                {conditions.length > 1 && (
                  <button onClick={() => removeCondition(i)} className="p-1 rounded hover:bg-[#f1f3f4] text-[#5f6368]"><X className="h-3.5 w-3.5" /></button>
                )}
              </div>
            ))}
            <button onClick={addCondition} className="text-xs text-[#0b57d0] hover:underline flex items-center gap-1"><Plus className="w-3 h-3" /> Add condition</button>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-[#5f6368]">Then</Label>
            <div className="flex items-center gap-2">
              <select value={action} onChange={(e) => setAction(e.target.value as "move" | "label" | "star" | "markRead")} className="text-sm border border-[#dadce0] rounded px-2 py-1.5 bg-white" data-testid="select-rule-action">
                <option value="move">Move to folder</option>
                <option value="label">Apply label</option>
                <option value="star">Star it</option>
                <option value="markRead">Mark as read</option>
              </select>
              {action === "move" && (
                <select value={targetFolder} onChange={(e) => setTargetFolder(e.target.value)} className="text-sm border border-[#dadce0] rounded px-2 py-1.5 bg-white" data-testid="select-rule-target-folder">
                  {allFolders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              )}
              {action === "label" && (
                <select value={targetLabel} onChange={(e) => setTargetLabel(e.target.value)} className="text-sm border border-[#dadce0] rounded px-2 py-1.5 bg-white" data-testid="select-rule-target-label">
                  <option value="">Select label...</option>
                  {labels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={() => editingRule ? saveMutation.mutate() : createMutation.mutate()} disabled={!canSave} className="rounded-full px-6" style={{ backgroundColor: "#0b57d0" }} data-testid="button-save-rule">
              {editingRule ? "Save Changes" : "Create Rule"}
            </Button>
            <Button onClick={resetForm} variant="outline" className="rounded-full px-4">Cancel</Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {rules.map(rule => (
          <div key={rule.id} className="flex items-center justify-between p-3 border border-[#dadce0] rounded-lg bg-white group">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[#202124]">{rule.name}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${rule.enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                  {rule.enabled ? "Active" : "Disabled"}
                </span>
              </div>
              <div className="text-xs text-[#5f6368] mt-0.5">
                {rule.conditions.map((c, i) => (
                  <span key={i}>
                    {i > 0 && <span className="mx-1 text-[#9aa0a6]">{rule.conditionLogic === "all" ? "AND" : "OR"}</span>}
                    <span className="font-medium">{c.field}</span> {c.match} "<span className="text-[#1a73e8]">{c.value}</span>"
                  </span>
                ))}
                <span className="mx-1">&rarr;</span>
                <span className="font-medium">
                  {rule.action === "move" && `Move to ${allFolders.find(f => f.id === rule.targetFolder)?.name || rule.targetFolder}`}
                  {rule.action === "label" && `Label: ${labels.find(l => l.id === rule.targetLabel)?.name || rule.targetLabel}`}
                  {rule.action === "star" && "Star"}
                  {rule.action === "markRead" && "Mark as read"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => updateMutation.mutate({ id: rule.id, updates: { enabled: !rule.enabled } })} className="p-1.5 rounded hover:bg-[#f1f3f4] text-[#5f6368] transition-colors" title={rule.enabled ? "Disable" : "Enable"}>
                {rule.enabled ? <Eye className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              </button>
              <button onClick={() => openEdit(rule)} className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-[#f1f3f4] text-[#5f6368]"><Pencil className="h-3.5 w-3.5" /></button>
              <button onClick={() => deleteMutation.mutate(rule.id)} className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-[#f1f3f4] text-[#5f6368] hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ))}
        {rules.length === 0 && !showForm && (
          <p className="text-sm text-[#5f6368] py-4 text-center">No rules yet. Create one to automatically sort your incoming emails.</p>
        )}
      </div>
    </div>
  );
}
