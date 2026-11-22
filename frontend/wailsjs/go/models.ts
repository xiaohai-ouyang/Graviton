export namespace appservice {
	
	export class AccountDisplay {
	    id: string;
	    email: string;
	    name: string;
	    isCurrent: boolean;
	    subscriptionTier: string;
	    remainingPercentage: number;
	    resetTime: string;
	    lastRefreshedAt: string;
	    lastSwitchedAt: string;
	    createdAt: string;
	    groups: storage.QuotaGroup[];
	    models: storage.ModelQuota[];
	    isForbidden: boolean;
	    errorMessage: string;
	
	    static createFrom(source: any = {}) {
	        return new AccountDisplay(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.email = source["email"];
	        this.name = source["name"];
	        this.isCurrent = source["isCurrent"];
	        this.subscriptionTier = source["subscriptionTier"];
	        this.remainingPercentage = source["remainingPercentage"];
	        this.resetTime = source["resetTime"];
	        this.lastRefreshedAt = source["lastRefreshedAt"];
	        this.lastSwitchedAt = source["lastSwitchedAt"];
	        this.createdAt = source["createdAt"];
	        this.groups = this.convertValues(source["groups"], storage.QuotaGroup);
	        this.models = this.convertValues(source["models"], storage.ModelQuota);
	        this.isForbidden = source["isForbidden"];
	        this.errorMessage = source["errorMessage"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ImportItemResult {
	    inputLabel: string;
	    success: boolean;
	    account?: AccountDisplay;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new ImportItemResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.inputLabel = source["inputLabel"];
	        this.success = source["success"];
	        this.account = this.convertValues(source["account"], AccountDisplay);
	        this.error = source["error"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class BatchImportResult {
	    total: number;
	    success: number;
	    failed: number;
	    results: ImportItemResult[];
	
	    static createFrom(source: any = {}) {
	        return new BatchImportResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.total = source["total"];
	        this.success = source["success"];
	        this.failed = source["failed"];
	        this.results = this.convertValues(source["results"], ImportItemResult);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class BatchRefreshResult {
	    accountId: string;
	    success: boolean;
	    errorMessage?: string;
	    account: AccountDisplay;
	
	    static createFrom(source: any = {}) {
	        return new BatchRefreshResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.accountId = source["accountId"];
	        this.success = source["success"];
	        this.errorMessage = source["errorMessage"];
	        this.account = this.convertValues(source["account"], AccountDisplay);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class OAuthStartResult {
	    authUrl: string;
	    state: string;
	    redirectUri: string;
	
	    static createFrom(source: any = {}) {
	        return new OAuthStartResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.authUrl = source["authUrl"];
	        this.state = source["state"];
	        this.redirectUri = source["redirectUri"];
	    }
	}

}

export namespace buildinfo {
	
	export class AppInfo {
	    version: string;
	    numericVersion: string;
	    channel: string;
	    commit: string;
	    buildTime: string;
	
	    static createFrom(source: any = {}) {
	        return new AppInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.numericVersion = source["numericVersion"];
	        this.channel = source["channel"];
	        this.commit = source["commit"];
	        this.buildTime = source["buildTime"];
	    }
	}
	export class ChangelogChange {
	    type: string;
	    text: string;
	
	    static createFrom(source: any = {}) {
	        return new ChangelogChange(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.text = source["text"];
	    }
	}
	export class ChangelogRelease {
	    version: string;
	    date: string;
	    channel: string;
	    title: string;
	    summary: string;
	    changes: ChangelogChange[];
	
	    static createFrom(source: any = {}) {
	        return new ChangelogRelease(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.date = source["date"];
	        this.channel = source["channel"];
	        this.title = source["title"];
	        this.summary = source["summary"];
	        this.changes = this.convertValues(source["changes"], ChangelogChange);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace client {
	
	export class SwitchResult {
	    success: boolean;
	    hotSwitched: boolean;
	    clientRelaunched: boolean;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new SwitchResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.hotSwitched = source["hotSwitched"];
	        this.clientRelaunched = source["clientRelaunched"];
	        this.message = source["message"];
	    }
	}

}

export namespace envmgr {
	
	export class AIConfig {
	    enabled: boolean;
	    baseUrl: string;
	    apiKey: string;
	    model: string;
	
	    static createFrom(source: any = {}) {
	        return new AIConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.baseUrl = source["baseUrl"];
	        this.apiKey = source["apiKey"];
	        this.model = source["model"];
	    }
	}
	export class LogEntry {
	    projectId: string;
	    commandId: string;
	    stream: string;
	    line: string;
	    timestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new LogEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.projectId = source["projectId"];
	        this.commandId = source["commandId"];
	        this.stream = source["stream"];
	        this.line = source["line"];
	        this.timestamp = source["timestamp"];
	    }
	}
	export class ShellAvailability {
	    shell: string;
	    label: string;
	    available: boolean;
	    path: string;
	    detail: string;
	
	    static createFrom(source: any = {}) {
	        return new ShellAvailability(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.shell = source["shell"];
	        this.label = source["label"];
	        this.available = source["available"];
	        this.path = source["path"];
	        this.detail = source["detail"];
	    }
	}
	export class ShellConfig {
	    defaultShell: string;
	    gitBashPath: string;
	
	    static createFrom(source: any = {}) {
	        return new ShellConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.defaultShell = source["defaultShell"];
	        this.gitBashPath = source["gitBashPath"];
	    }
	}
	export class ShellEnvironmentInfo {
	    config: ShellConfig;
	    shells: ShellAvailability[];
	
	    static createFrom(source: any = {}) {
	        return new ShellEnvironmentInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.config = this.convertValues(source["config"], ShellConfig);
	        this.shells = this.convertValues(source["shells"], ShellAvailability);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace main {
	
	export class WidgetConnection {
	    port: number;
	    token: string;
	    x: number;
	    y: number;
	    hasPos: boolean;
	
	    static createFrom(source: any = {}) {
	        return new WidgetConnection(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.port = source["port"];
	        this.token = source["token"];
	        this.x = source["x"];
	        this.y = source["y"];
	        this.hasPos = source["hasPos"];
	    }
	}

}

export namespace storage {
	
	export class ModelQuota {
	    name: string;
	    displayName?: string;
	    percentage: number;
	    resetTime?: string;
	
	    static createFrom(source: any = {}) {
	        return new ModelQuota(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.displayName = source["displayName"];
	        this.percentage = source["percentage"];
	        this.resetTime = source["resetTime"];
	    }
	}
	export class ProjectCommand {
	    id: string;
	    name: string;
	    command: string;
	    cwd: string;
	    shell?: string;
	    category: string;
	    pinned: boolean;
	    source: string;
	    subProject?: string;
	
	    static createFrom(source: any = {}) {
	        return new ProjectCommand(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.command = source["command"];
	        this.cwd = source["cwd"];
	        this.shell = source["shell"];
	        this.category = source["category"];
	        this.pinned = source["pinned"];
	        this.source = source["source"];
	        this.subProject = source["subProject"];
	    }
	}
	export class ProjectRecord {
	    id: string;
	    name: string;
	    path: string;
	    techStack: string[];
	    commands: ProjectCommand[];
	    pinned: boolean;
	    aiAnalyzed: boolean;
	    createdAt: string;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new ProjectRecord(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.path = source["path"];
	        this.techStack = source["techStack"];
	        this.commands = this.convertValues(source["commands"], ProjectCommand);
	        this.pinned = source["pinned"];
	        this.aiAnalyzed = source["aiAnalyzed"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class QuotaBucket {
	    bucketId: string;
	    window: string;
	    remainingFraction: number;
	    resetTime: string;
	    displayName?: string;
	    description?: string;
	
	    static createFrom(source: any = {}) {
	        return new QuotaBucket(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.bucketId = source["bucketId"];
	        this.window = source["window"];
	        this.remainingFraction = source["remainingFraction"];
	        this.resetTime = source["resetTime"];
	        this.displayName = source["displayName"];
	        this.description = source["description"];
	    }
	}
	export class QuotaGroup {
	    displayName: string;
	    description?: string;
	    buckets: QuotaBucket[];
	
	    static createFrom(source: any = {}) {
	        return new QuotaGroup(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.displayName = source["displayName"];
	        this.description = source["description"];
	        this.buckets = this.convertValues(source["buckets"], QuotaBucket);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace updater {
	
	export class UpdateState {
	    status: string;
	    currentVersion: string;
	    channel: string;
	    installMode: string;
	    latestVersion?: string;
	    releaseTitle?: string;
	    releaseNotes?: string;
	    releaseUrl?: string;
	    publishedAt?: string;
	    assetName?: string;
	    downloadedBytes: number;
	    totalBytes: number;
	    progress: number;
	    errorMessage?: string;
	    checkedAt?: string;
	    pendingRestart: boolean;
	    busyReasons?: string[];
	    autoCheckEnabled: boolean;
	    mirrorUrl: string;
	    skippedVersion?: string;
	    updatedFromVersion?: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.currentVersion = source["currentVersion"];
	        this.channel = source["channel"];
	        this.installMode = source["installMode"];
	        this.latestVersion = source["latestVersion"];
	        this.releaseTitle = source["releaseTitle"];
	        this.releaseNotes = source["releaseNotes"];
	        this.releaseUrl = source["releaseUrl"];
	        this.publishedAt = source["publishedAt"];
	        this.assetName = source["assetName"];
	        this.downloadedBytes = source["downloadedBytes"];
	        this.totalBytes = source["totalBytes"];
	        this.progress = source["progress"];
	        this.errorMessage = source["errorMessage"];
	        this.checkedAt = source["checkedAt"];
	        this.pendingRestart = source["pendingRestart"];
	        this.busyReasons = source["busyReasons"];
	        this.autoCheckEnabled = source["autoCheckEnabled"];
	        this.mirrorUrl = source["mirrorUrl"];
	        this.skippedVersion = source["skippedVersion"];
	        this.updatedFromVersion = source["updatedFromVersion"];
	    }
	}

}

export namespace widget {
	
	export class WindowBounds {
	    x: number;
	    y: number;
	    width: number;
	    height: number;
	
	    static createFrom(source: any = {}) {
	        return new WindowBounds(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.x = source["x"];
	        this.y = source["y"];
	        this.width = source["width"];
	        this.height = source["height"];
	    }
	}
	export class WorkArea {
	    left: number;
	    top: number;
	    right: number;
	    bottom: number;
	
	    static createFrom(source: any = {}) {
	        return new WorkArea(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.left = source["left"];
	        this.top = source["top"];
	        this.right = source["right"];
	        this.bottom = source["bottom"];
	    }
	}

}

