import { neon } from '@neondatabase/serverless_0_7';
import { geolocation } from '@vercel/edge';
import { NextFetchEvent, NextRequest, NextResponse } from 'next/server';

export const config = {
  runtime: 'edge',
};

const driverName = "@neondatabase/serverless@0.7.2";

interface SLRequest {
    connstr: string;
    queries: SLQuery[];
}

interface SLQuery {
    query: string;
    params: any[];
}

interface SLResponse {
    driverName: string;
    queries: CommonQuery[];
}

interface CommonQuery {
    exitnode: string;
    kind: string;
    addr: string;
    driver: string;
    method: string;
    request: string;
    response: string;
    error: string;
    startedAt: Date | undefined;
    finishedAt: Date | undefined;
    isFailed: boolean;
    durationNs: number | undefined;
}

const awaitTimeout = (delay: number) => new Promise(resolve => setTimeout(resolve, delay));

export default async (request: NextRequest, event: NextFetchEvent) => {
    try {
        const funcBootedAt = new Date();
        const globalTimeout = awaitTimeout(15000).then(() => undefined);

        const { region } = geolocation(request);
        const slRequest: SLRequest = await request.json();

        let queries: CommonQuery[] = [];
        const sql = neon(slRequest.connstr, { fullResults: true });

        for (const slQuery of slRequest.queries) {
            let params = (slQuery.params == null) ? undefined : slQuery.params;
            const startedAt = new Date();
            let finishedAt = undefined;
            let response = "";
            let error = "";
            let isFailed = false;

            try {
                console.log('running query ' + slQuery.query + ' with connstr ' + slRequest.connstr);
                const rawResult = await Promise.race([sql(slQuery.query, params), globalTimeout]);
                if (!rawResult) {
                    throw new Error("global 15s timeout exceeded, edge function was invoked at " + funcBootedAt.toISOString());
                }

                finishedAt = new Date();
                const res = {
                    rows: rawResult.rows,
                    rowCount: rawResult.rowCount,
                    command: rawResult.command,
                    fields: rawResult.fields,
                };
                response = JSON.stringify(res);
            } catch (e: any) {
                console.log('query caught exception: ' + e.stack);
                error = e.stack + "\n" + JSON.stringify(e);
                isFailed = true;
            }

            let durationNs;
            if (finishedAt != undefined && startedAt != undefined) {
                durationNs = (finishedAt.getTime() - startedAt.getTime()) * 1000000;
            }

            const common: CommonQuery = {
                exitnode: 'vercel-edge@' + region,
                kind: 'db',
                addr: slRequest.connstr,
                driver: driverName,
                method: 'http_query',
                request: JSON.stringify(slQuery),
                response,
                error,
                startedAt,
                finishedAt,
                isFailed,
                durationNs,
            };
            queries.push(common);

            if (isFailed) {
                break;
            }
        }

        const slResponse: SLResponse = {
            driverName,
            queries,
        };

        return NextResponse.json(slResponse);
    } catch (e: any) {
        console.log('global caught exception: ' + e.stack);
        return NextResponse.json({
            driverName,
            queries: [{
                exitnode: 'vercel-edge@unknown',
                kind: 'unhandled-exception',
                addr: "unknown",
                driver: driverName,
                method: 'catch',
                request: "",
                response: "",
                error: e.stack + "\n" + JSON.stringify(e),
                startedAt: undefined,
                finishedAt: undefined,
                isFailed: true,
                durationNs: undefined,
            }],
        });
    }
}
