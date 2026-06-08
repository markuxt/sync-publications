/**
 * OpenAlex API utilities.
 *
 * Addresses docs/code-review.md:
 *   #7  — uses fetchWithRetry for timeout + backoff retry on 429/5xx.
 *   #10 — keeps encodeURIComponent on filter values (verified to work).
 *   #14 — getWorksForAuthor returns OpenAlexWork[] (typed, not unknown[]).
 */
import { fetchWithRetry } from './http.js';
const OPENALEX_BASE = 'https://api.openalex.org';
/**
 * Fetch from OpenAlex API with mailto + User-Agent (polite pool).
 * Retries automatically on transient failures.
 */
export async function oaFetch(path, contactEmail) {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${OPENALEX_BASE}${path}${sep}mailto=${encodeURIComponent(contactEmail)}`;
    const res = await fetchWithRetry(url, {
        headers: {
            'User-Agent': `markuxt-sync-publications/1.0 (mailto:${contactEmail})`
        },
        timeoutMs: 30_000,
        retries: 3
    });
    if (!res.ok) {
        throw new Error(`OpenAlex ${res.status}: ${url}`);
    }
    return res.json();
}
/**
 * Get OpenAlex institution ID from a ROR ID.
 */
export async function getInstitutionId(rorId, contactEmail) {
    const data = await oaFetch(`/institutions?filter=ror:${encodeURIComponent(rorId)}&select=id`, contactEmail);
    if (!data.results?.length) {
        throw new Error(`Institution not found for ROR: ${rorId}`);
    }
    return data.results[0].id;
}
/**
 * Get OpenAlex author ID from an ORCID.
 */
export async function getAuthorId(orcid, contactEmail) {
    const data = await oaFetch(`/authors?filter=orcid:${encodeURIComponent(orcid)}&select=id`, contactEmail);
    return data.results?.[0]?.id ?? null;
}
/**
 * Get all works for an author affiliated with a specific institution.
 * Pages through OpenAlex's cursor pagination until exhausted.
 */
export async function getWorksForAuthor(authorId, institutionId, contactEmail) {
    const works = [];
    let cursor = '*';
    const fields = 'id,title,authorships,publication_year,doi,primary_location,keywords,abstract_inverted_index,open_access,best_oa_location';
    while (true) {
        const data = await oaFetch(`/works?filter=author.id:${encodeURIComponent(authorId)},institution.id:${encodeURIComponent(institutionId)}&per_page=200&cursor=${encodeURIComponent(cursor)}&select=${fields}`, contactEmail);
        works.push(...(data.results ?? []));
        if (!data.meta?.next_cursor)
            break;
        cursor = data.meta.next_cursor;
    }
    return works;
}
//# sourceMappingURL=openalex.js.map