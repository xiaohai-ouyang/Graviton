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

