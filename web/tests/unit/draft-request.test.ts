import { afterEach, describe, expect, it, vi } from 'vitest';
import { messages } from '@/i18n';
import { DraftRequestError, requestDraft } from '@/lib/draft-request';

describe('requestDraft', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('turns an unreachable server into a translatable error, not "Failed to fetch"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const error = await requestDraft('run-1', {}).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DraftRequestError);
    expect((error as DraftRequestError).messageKey).toBe('av_draft_unreachable');
  });

  it('turns a non-JSON answer into the generic failure, not a parser message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 })),
    );

    const error = await requestDraft('run-1', {}).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DraftRequestError);
    expect((error as DraftRequestError).messageKey).toBe('av_draft_failed');
  });

  it('returns the route answer, error responses included, for the view to read', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ error: 'Forbidden' }, { status: 403 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { response, result } = await requestDraft('run-1', { a: 1 });

    expect(response.status).toBe(403);
    expect(result.error).toBe('Forbidden');
    expect(fetchMock).toHaveBeenCalledWith('/api/workflow/run-1/draft', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ applicationData: { a: 1 } }),
    }));
  });

  it('has the unreachable message in every catalog', () => {
    for (const catalog of Object.values(messages)) {
      expect(catalog.av_draft_unreachable).toBeTruthy();
    }
  });
});
