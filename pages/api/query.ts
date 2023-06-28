import { Pool } from '@neondatabase/serverless';
import { geolocation } from '@vercel/edge';
import { NextFetchEvent, NextRequest, NextResponse } from 'next/server';
 
export const config = {
  runtime: 'edge',
};

const driverName = "@neondatabase/serverless@0.4.15";

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

export default async (request: NextRequest, event: NextFetchEvent) => {
    const { region } = geolocation(request);
    const slRequest: SLRequest = await request.json();

    let queries: CommonQuery[] = [];

    const pool = new Pool({
        connectionString: slRequest.connstr,
    });
    
    for (const slQuery of slRequest.queries) {
        let params = (slQuery.params == null) ? undefined : slQuery.params;
        const startedAt = new Date();
        let finishedAt = undefined;
        let response = "";
        let error = "";
        let isFailed = false;

        try {
            const rawResult = await pool.query(slQuery.query, params);
            finishedAt = new Date();
            const res = {
                rows: rawResult.rows,
                rowCount: rawResult.rowCount,
                command: rawResult.command,
                oid: rawResult.oid,
                fields: rawResult.fields,
            };
            response = JSON.stringify(res);
        } catch (e: any) {
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
            method: 'query',
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
            // don't continue with the rest of the queries
            break;
        }
    }

    const slResponse: SLResponse = {
        driverName,
        queries,
    };

    event.waitUntil(pool.end());  // doesn't hold up the response
    return NextResponse.json(slResponse);
}
