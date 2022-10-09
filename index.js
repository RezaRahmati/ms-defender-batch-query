import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv'
import { globby } from 'globby';
import moment from 'moment';
import * as Yaml from 'js-yaml';
import { default as converter } from 'json-2-csv';
import fetch from 'node-fetch';
import Bottleneck from "bottleneck";

dotenv.config();

let accessToken = null;

(async () => {

    try {
        console.time('Done');

        const limiter = new Bottleneck({
            minTime: 1500
        });

        const dateTime = getDate();

        const queryPath = process.env.QUERY_PATH;
        const outputPath = process.env.OUTPUT_PATH;
        const outputFlat = (process.env.OUTPUT_FLAT || 'false').toLowerCase() === 'true';

        // Get the files as an array
        const queryFiles = await globby([`${queryPath}/**/*.yaml`]);

        console.log(`${queryFiles.length} files found in ${queryPath} and sub folders`);

        for (const file of queryFiles) {

            console.log("Reading '%s' ", file);

            const yaml = Yaml.load(fs.readFileSync(file, { encoding: 'utf8' }));

            if (!yaml.query) {
                console.error(`Error ${file}: query not found`);
                continue;
            }

            if (!yaml.name) {
                console.error(`Error ${file}: name not found`);
                continue;
            }

            try {
                const result = await limiter.schedule(() => runQuery(yaml.query))

                console.log(`${yaml.name}:${result.length}`);

                const queryResultCsv = await converter.json2csvAsync(result);

                let folder = path.join(outputPath, dateTime);
                if (outputFlat === false) {
                    folder = path.join(folder, path.dirname(file).replace(queryPath, ''));
                }

                if (!fs.existsSync(folder)) {
                    fs.mkdirSync(folder, { recursive: true });
                }

                fs.writeFileSync(
                    path.join(folder, `${yaml.name}-${dateTime}-records-${result.length}.csv`),
                    queryResultCsv
                );
            }
            catch (e) {
                console.error(`Error Running Query ${file}`, e.message);
            }
        }

        console.timeEnd('Done')

    }
    catch (e) {
        console.error("Whoops!", e.message);
    }

})();

function getDate() {
    return moment().format('YYYY-MM-DD-HH-mm');
}

async function runQuery(query) {
    if (accessToken == null) {
        accessToken = await getAccessToken();
    }

    const url = "https://api.securitycenter.microsoft.com/api/advancedqueries/run";

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
            Query: query
        })
    }).then(res => res.json());

    if (response.error) {
        console.error(response.error);
        throw Error(response.error.message);
    }

    return response.Results;

}

async function getAccessToken() {
    const tenantId = process.env.TENANT_ID;
    const appId = process.env.APP_ID;
    const appSecret = process.env.APP_SECRET;

    const url = `https://login.microsoftonline.com/${tenantId}/oauth2/token`
    const resourceAppIdUri = 'https://api.securitycenter.microsoft.com'

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            'resource': resourceAppIdUri,
            'client_id': appId,
            'client_secret': appSecret,
            'grant_type': 'client_credentials'
        })
    }).then(res => res.json());

    return response.access_token;
}
