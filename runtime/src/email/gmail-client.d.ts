/**
 * Gmail API credentials
 */
export interface GmailCredentials {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
}
/**
 * Email message structure
 */
export interface EmailMessage {
    id: string;
    threadId: string;
    from: string;
    to: string[];
    subject: string;
    snippet: string;
    body: string;
    date: Date;
    labels: string[];
    isUnread: boolean;
}
/**
 * Gmail API client for full email access
 */
export declare class GmailClient {
    private oauth2Client;
    private gmail;
    private profileEmail?;
    constructor(credentials: GmailCredentials);
    /**
     * Get the authenticated user's email address (cached)
     */
    getProfileEmail(): Promise<string | null>;
    /**
     * List messages from inbox
     */
    listMessages(params: {
        maxResults?: number;
        query?: string;
    }): Promise<EmailMessage[]>;
    /**
     * Get full message details
     */
    private getMessage;
    /**
     * Send a new email
     */
    sendEmail(params: {
        to: string[];
        subject: string;
        body: string;
        html?: string;
    }): Promise<{
        messageId: string;
    }>;
    /**
     * Reply to an email thread
     */
    replyToEmail(params: {
        threadId: string;
        body: string;
        html?: string;
    }): Promise<{
        messageId: string;
    }>;
    /**
     * Search emails with Gmail query syntax
     */
    search(query: string): Promise<EmailMessage[]>;
    /**
     * Mark message as read
     */
    markAsRead(messageId: string): Promise<void>;
    /**
     * Mark message as unread
     */
    markAsUnread(messageId: string): Promise<void>;
    /**
     * Archive message (remove from inbox)
     */
    archive(messageId: string): Promise<void>;
    /**
     * Delete message (move to trash)
     */
    delete(messageId: string): Promise<void>;
    /**
     * Check if client is properly configured
     */
    static isConfigured(): boolean;
}
