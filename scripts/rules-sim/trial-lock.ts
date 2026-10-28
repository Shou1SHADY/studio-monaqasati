// A contractor whose trial has ended, against the REAL firestore.rules (Google's :test API), UAT read-only; users and
// documents are synthetic (overrides). The company cannot read or write anything it owns; its lock page can still read
// companyModules; a running trial, no trial, a trial with no end and the platform admin are untouched.

/* eslint-disable @typescript-eslint/no-explicit-any */
const cp = require("child_process")
const realExec = cp.execSync
const tokenCache: { v?: string; at?: number } = {}
cp.execSync = (cmd: string, opts: unknown) => {
  if (typeof cmd === "string" && cmd.startsWith("gcloud auth print-access-token")) {
    if (!tokenCache.v || Date.now() - (tokenCache.at ?? 0) > 3 * 60 * 1000) {
      tokenCache.v = realExec(cmd, opts)
      tokenCache.at = Date.now()
    }
    return tokenCache.v
  }
  return realExec(cmd, opts)
}
import { runAll, type Method, type RuleCase } from "./sim"

type Data = Record<string, any>
const FAR = 4102444800000

const world: Record<string, Data | null> = {
  "users/lockedOwner": { organizationId: "orgL", role: "Contractor", organizationRole: "owner" },
  "users/lockedMember": { organizationId: "orgL", role: "Contractor", organizationRole: "member", defaultGroupId: "all" },
  "users/liveOwner": { organizationId: "orgA", role: "Contractor", organizationRole: "owner" },
  "users/plainOwner": { organizationId: "orgP", role: "Contractor", organizationRole: "owner" },
  "users/activeOwner": { organizationId: "orgS", role: "Contractor", organizationRole: "owner" },
  "users/legacyOwner": { organizationId: "orgG", role: "Contractor", organizationRole: "owner" },
  "users/adm": { organizationId: "adm", role: "Admin" },
  "teamGroups/all": { organizationId: "orgL", permissions: ["*"] },
  "companyModules/orgL": { organizationId: "orgL", off: [], subscription: "trial", trialEndsMs: 1000 },
  "companyModules/orgA": { organizationId: "orgA", off: [], subscription: "trial", trialEndsMs: FAR },
  "companyModules/orgP": null,
  "companyModules/orgS": { organizationId: "orgS", off: [], subscription: "active", trialEndsMs: null },
  "companyModules/orgG": { organizationId: "orgG", off: [], subscription: "trial" },
  "warehouses/wL": { organizationId: "orgL", name: "L" },
  "warehouses/wA": { organizationId: "orgA", name: "A" },
  "crmContacts/cL": { organizationId: "orgL", name: "L" },
}

const NOW = "2026-11-10T09:00:00Z"
const mk = (name: string, uid: string | null, method: Method, path: string, expect: "ALLOW" | "DENY", before?: Data, after?: Data): RuleCase => ({ name, uid, method, path, before, after, overrides: world, expect, time: NOW })
const wh = (org: string) => ({ organizationId: org, name: "W" })

const cases: RuleCase[] = [
  mk("ended: the owner cannot create a warehouse", "lockedOwner", "create", "warehouses/n1", "DENY", undefined, wh("orgL")),
  mk("ended: a team member cannot either", "lockedMember", "create", "warehouses/n1", "DENY", undefined, wh("orgL")),
  mk("ended: the owner cannot update its warehouse", "lockedOwner", "update", "warehouses/wL", "DENY", world["warehouses/wL"] as Data, { organizationId: "orgL", name: "L2" }),
  mk("ended: the owner cannot delete it", "lockedOwner", "delete", "warehouses/wL", "DENY", world["warehouses/wL"] as Data),
  mk("ended: the owner cannot read it", "lockedOwner", "get", "warehouses/wL", "DENY", world["warehouses/wL"] as Data),
  mk("ended: the owner cannot create a CRM contact", "lockedOwner", "create", "crmContacts/n1", "DENY", undefined, wh("orgL")),
  mk("ended: the owner cannot update a CRM contact", "lockedOwner", "update", "crmContacts/cL", "DENY", world["crmContacts/cL"] as Data, { organizationId: "orgL", name: "L2" }),

  mk("ended: the lock page still reads the company's own companyModules", "lockedOwner", "get", "companyModules/orgL", "ALLOW", world["companyModules/orgL"] as Data),
  mk("ended: a team member reads it too", "lockedMember", "get", "companyModules/orgL", "ALLOW", world["companyModules/orgL"] as Data),
  mk("ended: it cannot read another company's", "lockedOwner", "get", "companyModules/orgA", "DENY", world["companyModules/orgA"] as Data),
  mk("ended: it still reads its own user document", "lockedOwner", "get", "users/lockedOwner", "ALLOW", world["users/lockedOwner"] as Data),
  mk("ended: it cannot write companyModules", "lockedOwner", "update", "companyModules/orgL", "DENY", world["companyModules/orgL"] as Data, { organizationId: "orgL", off: [], subscription: "active" }),

  mk("running trial: the owner creates a warehouse", "liveOwner", "create", "warehouses/n1", "ALLOW", undefined, wh("orgA")),
  mk("running trial: updates and reads it", "liveOwner", "update", "warehouses/wA", "ALLOW", world["warehouses/wA"] as Data, { organizationId: "orgA", name: "A2" }),
  mk("running trial: reads its companyModules", "liveOwner", "get", "companyModules/orgA", "ALLOW", world["companyModules/orgA"] as Data),
  mk("no companyModules document: works as before", "plainOwner", "create", "warehouses/n1", "ALLOW", undefined, wh("orgP")),
  mk("Active with the trial dates cleared: works as before", "activeOwner", "create", "warehouses/n1", "ALLOW", undefined, wh("orgS")),
  mk("a trial with no end (set before trials had a length): works as before", "legacyOwner", "create", "warehouses/n1", "ALLOW", undefined, wh("orgG")),
  mk("the platform admin is never locked", "adm", "create", "warehouses/n1", "ALLOW", undefined, wh("orgL")),
  mk("the platform admin writes companyModules", "adm", "update", "companyModules/orgL", "ALLOW", world["companyModules/orgL"] as Data, { organizationId: "orgL", off: [], subscription: "active" }),
  mk("another company cannot touch the locked company's warehouse", "liveOwner", "update", "warehouses/wL", "DENY", world["warehouses/wL"] as Data, { organizationId: "orgL", name: "X" }),
]

runAll(cases).then((bad) => process.exit(bad ? 1 : 0))
