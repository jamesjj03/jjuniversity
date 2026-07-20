import Link from "next/link";
import AtlasDraftImportPanel from "@/components/AtlasDraftImportPanel";
import {
  ATLAS_CATEGORY_GROUP_STATUSES,
  ATLAS_CORRECTION_STATUSES,
  ATLAS_CORRECTION_TYPES,
  ATLAS_PLANNED_MAP_STATUSES,
  ATLAS_REVIEW_STATUSES,
  linesToText,
  readAtlasCategoryReviewState,
  readAtlasAdminState,
  type AtlasCategoryDraftGroup,
  type AtlasCategoryReviewState,
  type AtlasAdminMapListItem,
  type AtlasFactoryState,
  type AtlasGenerationJobItem,
  type AtlasAdminGroup,
  type AtlasAdminMapDetail,
  type AtlasAdminSourceItem,
  type AtlasAdminSourceState,
  type AtlasMapRecipe,
  type AtlasPlannedMapItem,
  type AtlasPlannedMapStatus,
  type AtlasReviewStatus,
} from "@/lib/atlasAdmin";
import {
  addAtlasReviewCorrection,
  applyAtlasCategoryOperation,
  approveAtlasCategoryCheckpoint,
  attachAtlasCorpusSources,
  queueAtlasFactoryJob,
  updateAtlasCategoryGroup,
  updateAtlasContributor,
  updateAtlasGroup,
  updateAtlasMap,
  updateAtlasPlannedMapFactory,
  updateAtlasQualityScorecard,
  updateAtlasRecipe,
  updateAtlasRecipeFeedback,
  updateAtlasRelation,
} from "@/app/admin/atlas/actions";
import type { AtlasProvenanceRef } from "@/lib/atlasMaps";
import type { AtlasCorpusCandidateSet, AtlasSourceSufficiency } from "@/lib/atlasCorpusBridge";

type AtlasAdminPageProps = {
  searchParams: Promise<{
    map?: string | string[];
    reference?: string | string[];
    saved?: string | string[];
    corpusFocusMapId?: string | string[];
    corpusKeywords?: string | string[];
    corpusIncludeLaneIds?: string | string[];
    corpusExcludeLaneIds?: string | string[];
  }>;
};

const REVIEW_STATUS_LABELS: Record<AtlasReviewStatus, string> = {
  draft: "Draft",
  needs_review: "Needs review",
  published: "Published",
  archived: "Archived",
};

const PLANNED_STATUS_LABELS: Record<AtlasPlannedMapStatus, string> = {
  idea: "Idea",
  queued: "Queued",
  generating: "Generating",
  needs_review: "Needs review",
  published: "Published",
  paused: "Paused",
};

export const metadata = {
  title: "Atlas Review | JJ University",
  description: "Admin review and editing tools for Atlas maps.",
};

export const dynamic = "force-dynamic";

export default async function AtlasAdminPage({ searchParams }: AtlasAdminPageProps) {
  const params = await searchParams;
  const selectedMapParam = firstParam(params.map);
  const referenceParam = firstParam(params.reference);
  const savedParam = firstParam(params.saved);
  const state = await readAtlasAdminState(selectedMapParam, {
    corpusBridge: {
      focusPlannedMapId: firstParam(params.corpusFocusMapId),
      humanKeywords: linesFromParam(params.corpusKeywords),
      includeLaneIds: paramArray(params.corpusIncludeLaneIds),
      excludeLaneIds: paramArray(params.corpusExcludeLaneIds),
    },
  });
  const selectedMap = state.selectedMap;
  const categoryReview = selectedMap
    ? await readAtlasCategoryReviewState(selectedMap, state.maps, referenceParam)
    : null;
  const stats = {
    maps: state.maps.length,
    published: state.maps.filter(map => map.reviewStatus === "published").length,
    review: state.maps.filter(map => map.reviewStatus === "needs_review").length,
    draft: state.maps.filter(map => map.reviewStatus === "draft").length,
  };

  return (
    <main className="page atlasAdminPage">
      <section className="atlasAdminHero">
        <div>
          <p className="kicker">Admin</p>
          <h1>Atlas Review</h1>
        </div>
        <div className="atlasAdminHeroActions">
          <Link className="btn secondary" href="/admin">Admin</Link>
          <Link className="btn secondary" href="/atlas">Public Atlas</Link>
        </div>
      </section>

      <section className="atlasAdminStats" aria-label="Atlas review snapshot">
        <div><strong>{stats.maps}</strong><span>Maps</span></div>
        <div><strong>{stats.published}</strong><span>Published</span></div>
        <div><strong>{stats.review}</strong><span>Review</span></div>
        <div><strong>{stats.draft}</strong><span>Draft</span></div>
      </section>

      {savedParam && (
        <div className="adminNotice atlasAdminNotice">Saved {savedLabel(savedParam)}.</div>
      )}

      {state.configMissing && (
        <section className="adminPanel atlasAdminEmpty">
          <h2>Supabase admin config is missing.</h2>
          <p>Add the Supabase URL and service-role key before editing Atlas maps.</p>
        </section>
      )}

      {state.error && (
        <section className="adminPanel atlasAdminEmpty">
          <h2>Atlas maps could not load.</h2>
          <p>{state.error}</p>
        </section>
      )}

      {!state.configMissing && !state.error && (
        <>
          <AtlasSourceIngestPanel sourceState={state.sourceIngest} />

          <AtlasFactoryPanel factory={state.factory} sources={state.sourceIngest.sources} />

          <AtlasDraftImportPanel />

          <section className="atlasAdminShell" aria-label="Atlas CMS">
            <aside className="atlasAdminMapList" aria-label="Atlas maps">
              {state.maps.map(map => (
                <Link
                  className={map.id === selectedMap?.id ? "active atlasAdminMapRow" : "atlasAdminMapRow"}
                  href={`/admin/atlas?map=${encodeURIComponent(map.id)}`}
                  key={map.id}
                  prefetch={false}
                >
                  <span>
                    <strong>{map.title}</strong>
                    <small>{map.territoryTitle} / {map.branchTitle}</small>
                  </span>
                  <em className={`atlasAdminStatus ${map.reviewStatus}`}>{REVIEW_STATUS_LABELS[map.reviewStatus]}</em>
                  <time>{formatDate(map.updatedAt)}</time>
                </Link>
              ))}
            </aside>

            {selectedMap ? (
              <section className="atlasAdminEditorStack">
                {categoryReview && <AtlasCategoryReviewPanel map={selectedMap} maps={state.maps} review={categoryReview} />}
                <SelectedMapEditor map={selectedMap} />
              </section>
            ) : (
              <section className="adminPanel atlasAdminEmpty">
                <h2>No Atlas maps found.</h2>
                <p>Import the AtlasMapSpec seed before reviewing maps.</p>
              </section>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function AtlasFactoryPanel({ factory, sources }: { factory: AtlasFactoryState; sources: AtlasAdminSourceItem[] }) {
  const recipeById = new Map(factory.recipes.map(recipe => [recipe.id, recipe]));
  const latestJobs = factory.jobs.slice(0, 8);

  return (
    <section className="adminPanel atlasFactoryPanel" aria-label="Atlas factory">
      <div className="atlasAdminPanelTop">
        <div>
          <p className="kicker">Factory</p>
          <h2>Taxonomy, Recipes, Queue</h2>
        </div>
        <div className="atlasFactoryStats" aria-label="Atlas factory counts">
          <span><strong>{formatNumber(factory.plannedMaps.length)}</strong> planned</span>
          <span><strong>{formatNumber(factory.recipes.length)}</strong> recipes</span>
          <span><strong>{formatNumber(factory.jobs.length)}</strong> jobs</span>
        </div>
      </div>

      {factory.error && (
        <div className="atlasSourceNotice">
          {factory.tablesMissing
            ? "Apply the Atlas factory schema before the map factory can run."
            : factory.error}
        </div>
      )}

      {!factory.error && (
        <div className="atlasFactoryLayout">
          <div className="atlasFactoryPlannedStack" aria-label="Planned Atlas maps">
            <section className="atlasCorpusBridgePanel" aria-label="Atlas corpus bridge">
              <header>
                <div>
                  <p className="kicker">Corpus Bridge</p>
                  <h3>{factory.corpusBridge.sourceName}</h3>
                </div>
                <em className={factory.corpusBridge.available ? "ready" : "blocked"}>
                  {factory.corpusBridge.available ? "available" : "unavailable"}
                </em>
              </header>
              <div className="atlasSufficiencyGrid">
                <span><strong>{formatNumber(factory.corpusBridge.sourceCount)}</strong> sources</span>
                <span><strong>{formatNumber(factory.corpusBridge.chunkCount)}</strong> chunks</span>
                <span><strong>{factory.corpusBridge.ftsEnabled ? "yes" : "no"}</strong> FTS</span>
              </div>
              <code>{factory.corpusBridge.dbPath || "No corpus path configured"}</code>
              {factory.corpusBridge.error && <p className="atlasFactoryNote">{factory.corpusBridge.error}</p>}
            </section>

            <header className="atlasAdminSectionHeader">
              <div>
                <p className="kicker">Planned Maps</p>
                <h2>{factory.plannedMaps.length} map ideas</h2>
              </div>
            </header>

            {factory.plannedMaps.map(plannedMap => (
              <PlannedMapFactoryCard
                key={plannedMap.id}
                plannedMap={plannedMap}
                recipes={factory.recipes}
                recipe={recipeById.get(plannedMap.recipeId)}
                sources={sources}
                corpusCandidates={factory.corpusBridge.candidatesByPlannedMapId[plannedMap.id]}
              />
            ))}
          </div>

          <aside className="atlasFactorySideStack">
            <section className="atlasFactoryJobs" aria-label="Atlas generation jobs">
              <header className="atlasAdminSectionHeader">
                <div>
                  <p className="kicker">Queue</p>
                  <h2>Recent jobs</h2>
                </div>
              </header>

              {latestJobs.length === 0 && <div className="atlasSourceNotice">No factory jobs queued yet.</div>}

              {latestJobs.map(job => <FactoryJobCard key={job.id} job={job} />)}
            </section>

            <section className="atlasFactoryRecipes" aria-label="Atlas map recipes">
              <header className="atlasAdminSectionHeader">
                <div>
                  <p className="kicker">Recipes</p>
                  <h2>{factory.recipes.length} archetypes</h2>
                </div>
              </header>

              {factory.recipes.map(recipe => <RecipeEditor key={recipe.id} recipe={recipe} />)}
            </section>
          </aside>
        </div>
      )}
    </section>
  );
}

function PlannedMapFactoryCard({
  plannedMap,
  recipes,
  recipe,
  sources,
  corpusCandidates,
}: {
  plannedMap: AtlasPlannedMapItem;
  recipes: AtlasMapRecipe[];
  recipe?: AtlasMapRecipe;
  sources: AtlasAdminSourceItem[];
  corpusCandidates?: AtlasCorpusCandidateSet;
}) {
  const matchingSources = sources.filter(source => sourceMatchesPlannedMap(source, plannedMap));
  const selectableSources = matchingSources.length ? matchingSources : sources.slice(0, 8);

  return (
    <article className="atlasFactoryPlannedCard">
      <header>
        <div>
          <strong>{plannedMap.mapTitle}</strong>
          <small>{plannedMap.territoryTitle} / {plannedMap.branchTitle}</small>
        </div>
        <em className={`atlasFactoryStatus ${plannedMap.status}`}>{PLANNED_STATUS_LABELS[plannedMap.status]}</em>
      </header>

      <p>{plannedMap.summary}</p>
      <div className="atlasFactoryMeta">
        <code>{plannedMap.territorySlug}/{plannedMap.branchSlug}/{plannedMap.mapSlug}</code>
        <span>{recipe?.title || "No recipe"}</span>
      </div>

      {plannedMap.sourceRequirements && <p className="atlasFactoryNote">{plannedMap.sourceRequirements}</p>}

      <AtlasCorpusCandidatePanel plannedMap={plannedMap} candidates={corpusCandidates} />

      <form className="atlasFactorySettingsForm" action={updateAtlasPlannedMapFactory}>
        <input type="hidden" name="plannedMapId" value={plannedMap.id} />
        <label>
          <span>Recipe</span>
          <select className="select" name="recipeId" defaultValue={plannedMap.recipeId}>
            <option value="">Unassigned</option>
            {recipes.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
        </label>
        <label>
          <span>Status</span>
          <select className="select" name="status" defaultValue={plannedMap.status}>
            {ATLAS_PLANNED_MAP_STATUSES.map(status => (
              <option key={status} value={status}>{PLANNED_STATUS_LABELS[status]}</option>
            ))}
          </select>
        </label>
        <button className="resetBtn" type="submit">Save Plan</button>
      </form>

      <form className="atlasFactoryQueueForm" action={queueAtlasFactoryJob}>
        <input type="hidden" name="plannedMapId" value={plannedMap.id} />
        <label>
          <span>Generation recipe</span>
          <select className="select" name="recipeId" defaultValue={plannedMap.recipeId}>
            {recipes.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
        </label>
        <label>
          <span>Topic prompt</span>
          <textarea name="topicPrompt" defaultValue={plannedMap.summary} />
        </label>

        <div className="atlasFactorySourcePicker" aria-label={`${plannedMap.mapTitle} sources`}>
          {selectableSources.length === 0 && <span>No sources available.</span>}
          {selectableSources.map(source => (
            <label key={source.id}>
              <input
                type="checkbox"
                name="sourceIds"
                value={source.id}
                defaultChecked={matchingSources.some(item => item.id === source.id)}
              />
              <span>
                <strong>{source.title}</strong>
                <small>{source.mapSlug || source.branchSlug} / {formatNumber(source.chunkCount)} chunks</small>
              </span>
            </label>
          ))}
        </div>

        <div className="atlasFactoryModelGrid">
          <label>
            <span>Provider</span>
            <input className="input" name="provider" placeholder="local-openai-compatible" />
          </label>
          <label>
            <span>Model</span>
            <input className="input" name="model" placeholder="mistralai/mistral-7b-instruct-v0.3" />
          </label>
          <label>
            <span>Endpoint</span>
            <input className="input" name="endpoint" placeholder="http://127.0.0.1:1234/v1/chat/completions" />
          </label>
        </div>

        <button className="formBtn" type="submit">Queue Job</button>
      </form>
    </article>
  );
}

function AtlasCorpusCandidatePanel({
  plannedMap,
  candidates,
}: {
  plannedMap: AtlasPlannedMapItem;
  candidates?: AtlasCorpusCandidateSet;
}) {
  if (!candidates) {
    return (
      <section className="atlasCorpusCandidatePanel">
        <header>
          <span>
            <strong>Corpus Candidates</strong>
            <small>No candidate query was loaded for this planned map.</small>
          </span>
        </header>
      </section>
    );
  }

  return (
    <section className="atlasCorpusCandidatePanel" aria-label={`${plannedMap.mapTitle} corpus candidates`}>
      <header>
        <span>
          <strong>Corpus Candidates</strong>
          <small>{formatNumber(candidates.candidates.length)} sources from the Pipeline KB</small>
        </span>
      </header>

      <code>{candidates.query}</code>
      <div className="atlasCorpusDiagnostics">
        <span><strong>{formatNumber(candidates.diagnostics.matchedSourceTitles.length)}</strong> matched sources</span>
        <span><strong>{formatNumber(candidates.diagnostics.matchedChunkCount)}</strong> matched chunks</span>
        <span><strong>{formatNumber(candidates.diagnostics.selectedChunkCount)}</strong> selected chunks</span>
      </div>
      <details className="atlasCorpusLaneDetails" open={plannedMap.mapSlug === "systems-design"}>
        <summary>Search lanes and retrieval controls</summary>
        <form className="atlasCorpusLaneForm">
          <input type="hidden" name="corpusFocusMapId" value={plannedMap.id} />
          <label>
            <span>Human keywords</span>
            <textarea
              name="corpusKeywords"
              defaultValue={candidates.searchPlan.humanKeywords.join("\n")}
              placeholder="Optional: one keyword, entity, or phrase per line"
            />
          </label>
          <div className="atlasCorpusLaneGrid">
            {candidates.searchPlan.lanes.map(laneItem => {
              const coverage = candidates.sufficiency.laneCoverage.find(item => item.laneId === laneItem.id);
              return (
                <label key={laneItem.id}>
                  <input
                    type="checkbox"
                    name="corpusIncludeLaneIds"
                    value={laneItem.id}
                    defaultChecked={!candidates.searchPlan.includedLaneIds.length || candidates.searchPlan.includedLaneIds.includes(laneItem.id)}
                  />
                  <span>
                    <strong>{laneItem.title}</strong>
                    <small>{coverage?.chunkCount || 0} chunks / {coverage?.sourceCount || 0} sources</small>
                    <em>{laneItem.reason}</em>
                  </span>
                </label>
              );
            })}
          </div>
          <button className="resetBtn" type="submit">Apply Retrieval Filters</button>
        </form>
      </details>
      <AtlasSufficiencySummary sufficiency={candidates.sufficiency} />

      {candidates.error && <p className="atlasFactoryNote">{candidates.error}</p>}
      {(candidates.diagnostics.duplicateWarnings.length > 0 || candidates.diagnostics.overrepresentationWarnings.length > 0) && (
        <ul className="atlasSufficiencyWarnings">
          {[...candidates.diagnostics.duplicateWarnings, ...candidates.diagnostics.overrepresentationWarnings].map(warning => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      {!candidates.error && candidates.candidates.length === 0 && (
        <p className="atlasFactoryNote">No corpus candidates matched this planned map yet.</p>
      )}

      {candidates.candidates.length > 0 && (
        <form className="atlasCorpusCandidateForm" action={attachAtlasCorpusSources}>
          <input type="hidden" name="plannedMapId" value={plannedMap.id} />
          <input type="hidden" name="corpusKeywords" value={candidates.searchPlan.humanKeywords.join("\n")} />
          {candidates.searchPlan.lanes.map(laneItem => (
            <input key={laneItem.id} type="hidden" name="corpusIncludeLaneIds" value={laneItem.id} />
          ))}
          <div className="atlasCorpusCandidateList">
            {candidates.candidates.map(candidate => (
              <label className="atlasCorpusCandidateCard" key={candidate.sourceId}>
                <input type="checkbox" name="corpusSourceIds" value={candidate.sourceId} />
                <span>
                  <strong>{candidate.title}</strong>
                  <small>{candidate.sourceType} / {candidate.reliabilityTier} / {candidate.origin}</small>
                  <em>{candidate.relevanceReason}</em>
                  <span className="atlasCorpusTagRow">
                    {candidate.laneIds.slice(0, 6).map(laneId => <b key={laneId}>{laneId}</b>)}
                    {candidate.coverageTags.slice(0, 6).map(tag => <i key={tag}>{tag.replace(/_/g, " ")}</i>)}
                  </span>
                  <code>{candidate.sourcePath || candidate.sourceId}</code>
                  <span className="atlasCorpusChunkList">
                    {candidate.matchingChunks.slice(0, 4).map(chunk => (
                      <span key={chunk.sourceChunkId}>
                        <b>#{chunk.chunkIndex}</b>
                        <small>{chunk.laneIds.join(", ")} {chunk.score ? ` / fts ${chunk.score.toFixed(2)}` : ""}</small>
                        {chunk.snippet}
                      </span>
                    ))}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <button className="resetBtn" type="submit">Attach Selected Corpus Sources</button>
        </form>
      )}
    </section>
  );
}

function FactoryJobCard({ job }: { job: AtlasGenerationJobItem }) {
  return (
    <article className="atlasFactoryJobCard">
      <header>
        <div>
          <strong>{job.mapTitle || job.mapSlug}</strong>
          <small>{job.territorySlug} / {job.branchSlug}</small>
        </div>
        <em className={`atlasFactoryStatus ${job.status}`}>{job.status.replace(/_/g, " ")}</em>
      </header>
      <div className="atlasFactoryMeta">
        <span>{job.recipeId || "No recipe"}</span>
        <time>{formatDate(job.createdAt)}</time>
      </div>
      {(job.currentStage || job.safeInputTokens > 0) && (
        <div className="atlasFactoryProgress">
          {job.currentStage && <span>Stage <strong>{job.currentStage}</strong></span>}
          {job.totalBatches > 0 && <span>Batches <strong>{job.completedBatches}/{job.totalBatches}</strong></span>}
          {job.totalGroups > 0 && <span>Groups <strong>{job.completedGroups}/{job.totalGroups}</strong></span>}
          {job.safeInputTokens > 0 && <span>Budget <strong>{formatNumber(job.safeInputTokens)}/{formatNumber(job.contextWindowTokens)}</strong></span>}
          {job.resumeAvailable && <span>Resume <strong>available</strong></span>}
        </div>
      )}
      {job.runId && <code>{job.runId}</code>}
      {job.outputDraftPath && <code>{job.outputDraftPath}</code>}
      {job.sourceSufficiency && <AtlasSufficiencySummary sufficiency={job.sourceSufficiency} />}
      {(job.latestError || job.errorSummary) && <p className="atlasFactoryNote">{job.latestError || job.errorSummary}</p>}
      {job.command && (
        <details>
          <summary>Command</summary>
          <code>{job.command}</code>
        </details>
      )}
    </article>
  );
}

function AtlasSufficiencySummary({ sufficiency }: { sufficiency: AtlasSourceSufficiency }) {
  return (
    <div className="atlasSufficiencySummary">
      <div className="atlasSufficiencyGrid">
        <span><strong>{sufficiency.confidence}</strong> confidence</span>
        <span><strong>{formatNumber(sufficiency.sourceCount)}</strong> sources</span>
        <span><strong>{formatNumber(sufficiency.chunkCount)}</strong> chunks</span>
        <span><strong>{formatNumber(sufficiency.sourceDiversity)}</strong> types</span>
        <span><strong>{sufficiency.categoryCoverage}%</strong> category coverage</span>
        <span><strong>{sufficiency.chronologyCoverage.replace(/_/g, " ")}</strong> chronology</span>
        <span><strong>{sufficiency.contributorTextCoverage}</strong> contributors/texts</span>
        <span><strong>{sufficiency.conceptTheoryCoverage}</strong> concepts</span>
        <span><strong>{sufficiency.relationEvidenceCoverage}</strong> relations</span>
      </div>
      {sufficiency.laneCoverage.length > 0 && (
        <div className="atlasCorpusLaneCoverage">
          {sufficiency.laneCoverage.map(laneItem => (
            <span className={laneItem.covered ? "covered" : "missing"} key={laneItem.laneId}>
              <strong>{laneItem.title}</strong>
              <small>{laneItem.sourceCount} sources / {laneItem.chunkCount} chunks</small>
            </span>
          ))}
        </div>
      )}
      {sufficiency.warnings.length > 0 && (
        <ul className="atlasSufficiencyWarnings">
          {sufficiency.warnings.map(warning => <li key={warning}>{warning}</li>)}
        </ul>
      )}
    </div>
  );
}

function RecipeEditor({ recipe }: { recipe: AtlasMapRecipe }) {
  return (
    <details className="atlasFactoryRecipeCard">
      <summary>
        <span>
          <strong>{recipe.title}</strong>
          <small>{recipe.id}</small>
        </span>
      </summary>

      <form className="atlasFactoryRecipeForm" action={updateAtlasRecipe}>
        <input type="hidden" name="recipeId" value={recipe.id} />
        <label>
          <span>Title</span>
          <input className="input" name="title" defaultValue={recipe.title} />
        </label>
        <label>
          <span>Purpose</span>
          <textarea name="purpose" defaultValue={recipe.purpose} />
        </label>
        <label>
          <span>Grouping logic</span>
          <textarea name="groupingLogic" defaultValue={recipe.groupingLogic} />
        </label>
        <label>
          <span>Preferred fields</span>
          <textarea name="preferredGroupFields" defaultValue={linesToText(recipe.preferredGroupFields)} />
        </label>
        <label>
          <span>Contributor rules</span>
          <textarea name="contributorRules" defaultValue={recipe.contributorRules} />
        </label>
        <label>
          <span>Relation types</span>
          <textarea name="expectedRelationTypes" defaultValue={linesToText(recipe.expectedRelationTypes)} />
        </label>
        <div className="atlasFactoryModelGrid">
          <label>
            <span>Min groups</span>
            <input className="input" name="recommendedMin" type="number" min="1" defaultValue={recipe.recommendedGroupCount.min} />
          </label>
          <label>
            <span>Max groups</span>
            <input className="input" name="recommendedMax" type="number" min="1" defaultValue={recipe.recommendedGroupCount.max} />
          </label>
        </div>
        <label>
          <span>Generation instructions</span>
          <textarea name="generationInstructions" defaultValue={recipe.generationInstructions} />
        </label>
        <label>
          <span>Evaluation criteria</span>
          <textarea name="evaluationCriteria" defaultValue={linesToText(recipe.evaluationCriteria)} />
        </label>
        <button className="resetBtn" type="submit">Save Recipe</button>
      </form>
    </details>
  );
}

function AtlasSourceIngestPanel({ sourceState }: { sourceState: AtlasAdminSourceState }) {
  return (
    <section className="adminPanel atlasSourceIngestPanel" aria-label="Atlas source ingest">
      <div className="atlasAdminPanelTop">
        <div>
          <p className="kicker">Source Ingest</p>
          <h2>Grounding Library</h2>
        </div>
        <div className="atlasSourceStats" aria-label="Atlas source counts">
          <span><strong>{formatNumber(sourceState.totalSources)}</strong> sources</span>
          <span><strong>{formatNumber(sourceState.totalChunks)}</strong> chunks</span>
        </div>
      </div>

      {sourceState.error && (
        <div className="atlasSourceNotice">
          {sourceState.tablesMissing
            ? "Apply the Atlas source ingest schema before sources can appear here."
            : sourceState.error}
        </div>
      )}

      {!sourceState.error && sourceState.sources.length === 0 && (
        <div className="atlasSourceNotice">No Atlas sources ingested yet.</div>
      )}

      {sourceState.sources.length > 0 && (
        <div className="atlasSourceList">
          {sourceState.sources.map(source => (
            <article className="atlasSourceRow" key={source.id}>
              <div>
                <strong>{source.title}</strong>
                <small>{source.territorySlug || "unknown"} / {source.branchSlug || "unknown"} / {source.mapSlug || "unassigned"}</small>
              </div>
              <div className="atlasSourceMeta">
                <span>{source.sourceType}</span>
                <span>{formatNumber(source.chunkCount)} chunks</span>
                <span>{formatNumber(source.charCount)} chars</span>
              </div>
              <code>{source.filePath || source.canonicalUrl || source.id}</code>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function AtlasCategoryReviewPanel({
  map,
  maps,
  review,
}: {
  map: AtlasAdminMapDetail;
  maps: AtlasAdminMapListItem[];
  review: AtlasCategoryReviewState;
}) {
  const checkpointGroups = review.checkpoint?.groups.length ? review.checkpoint.groups : draftGroupsForView(map);
  const reviewByGroupId = new Map(review.groupReviews.map(groupReview => [groupReview.groupId, groupReview]));
  const groups = checkpointGroups.map(group => {
    const groupReview = reviewByGroupId.get(group.id);
    return groupReview ? {
      ...group,
      status: groupReview.status,
      title: groupReview.proposedTitle || group.title,
      shortTitle: groupReview.proposedShortTitle || group.shortTitle,
      centralClaim: groupReview.proposedCentralClaim || group.centralClaim,
      relatedGroupIds: groupReview.proposedRelatedGroupIds.length ? groupReview.proposedRelatedGroupIds : group.relatedGroupIds,
      notes: groupReview.notes || group.notes,
    } : group;
  });
  const chunkById = new Map(review.sourceChunks.map(chunk => [chunk.chunkId, chunk]));

  return (
    <section className="adminPanel atlasCategoryReviewPanel" aria-label="Atlas category quality control">
      <div className="atlasAdminPanelTop">
        <div>
          <p className="kicker">Category QC</p>
          <h2>{map.title}</h2>
        </div>
        <div className="atlasCategoryStatusStack">
          <span>{review.checkpoint?.status || "not started"}</span>
          {review.recipeId && <code>{review.recipeId}</code>}
        </div>
      </div>

      {review.error && (
        <div className="atlasSourceNotice">
          {review.tablesMissing ? "Apply the Atlas quality-control schema before category review can save." : review.error}
        </div>
      )}

      {!review.error && (
        <>
          <form className="atlasCategoryReferenceForm" method="get">
            <input type="hidden" name="map" value={map.id} />
            <label>
              <span>Reference map</span>
              <select className="select" name="reference" defaultValue={review.referenceMapId}>
                <option value="">No reference</option>
                {maps.filter(item => item.id !== map.id).map(item => (
                  <option key={item.id} value={item.id}>{item.title} ({item.reviewStatus})</option>
                ))}
              </select>
            </label>
            <button className="resetBtn" type="submit">Compare</button>
          </form>

          <div className="atlasCategoryGrid">
            <section className="atlasCategoryGroups" aria-label="Generated category review">
              <header className="atlasAdminSectionHeader">
                <div>
                  <p className="kicker">Generated Structure</p>
                  <h2>{groups.length} groups</h2>
                </div>
              </header>

              <AddCategoryGroupForm mapId={map.id} referenceMapId={review.referenceMapId} />

              {groups.map((group, index) => (
                <CategoryGroupReviewCard
                  allGroups={groups}
                  chunkById={chunkById}
                  group={group}
                  key={group.id}
                  mapId={map.id}
                  referenceMapId={review.referenceMapId}
                  open={index === 0}
                />
              ))}
            </section>

            <aside className="atlasCategorySide" aria-label="Category review score and comparison">
              <CategoryComparison generatedGroups={groups} generatedMap={map} referenceMap={review.referenceMap} />
              <QualityScorecardForm mapId={map.id} referenceMapId={review.referenceMapId} scorecard={review.scorecard} />
              <CorrectionCapturePanel mapId={map.id} referenceMapId={review.referenceMapId} corrections={review.corrections} />
              <RecipeFeedbackPanel feedback={review.recipeFeedback} recipeId={review.recipeId} />
              <CategoryCheckpointPanel mapId={map.id} referenceMapId={review.referenceMapId} checkpointStatus={review.checkpoint?.status || "draft"} />
            </aside>
          </div>
        </>
      )}
    </section>
  );
}

function AddCategoryGroupForm({ mapId, referenceMapId }: { mapId: string; referenceMapId: string }) {
  return (
    <form className="atlasCategoryInlineForm" action={applyAtlasCategoryOperation}>
      <input type="hidden" name="mapId" value={mapId} />
      <input type="hidden" name="referenceMapId" value={referenceMapId} />
      <input type="hidden" name="operation" value="add_group" />
      <label>
        <span>Add group</span>
        <input className="input" name="newGroupTitle" placeholder="New category title" />
      </label>
      <label>
        <span>Reason</span>
        <input className="input" name="reason" placeholder="Coverage gap or review note" />
      </label>
      <button className="resetBtn" type="submit">Add</button>
    </form>
  );
}

function CategoryGroupReviewCard({
  group,
  allGroups,
  chunkById,
  mapId,
  referenceMapId,
  open,
}: {
  group: AtlasCategoryDraftGroup;
  allGroups: AtlasCategoryDraftGroup[];
  chunkById: Map<string, { heading: string; excerpt: string }>;
  mapId: string;
  referenceMapId: string;
  open: boolean;
}) {
  const otherGroups = allGroups.filter(item => item.id !== group.id);
  const groupRefs = group.provenance.length ? group.provenance : [
    ...group.contributors.flatMap(contributor => contributor.provenance),
    ...group.texts.flatMap(text => text.provenance),
  ];

  return (
    <details className={`atlasCategoryGroupCard ${group.status}`} open={open}>
      <summary>
        <span>
          <strong>{group.title}</strong>
          <small>{group.status} / {group.contributors.length} contributors / {group.texts.length} texts</small>
        </span>
      </summary>

      <form className="atlasCategoryGroupForm" action={updateAtlasCategoryGroup}>
        <input type="hidden" name="mapId" value={mapId} />
        <input type="hidden" name="referenceMapId" value={referenceMapId} />
        <input type="hidden" name="groupId" value={group.id} />
        <div className="atlasCategoryTwoCol">
          <label>
            <span>Group name</span>
            <input className="input" name="title" defaultValue={group.title} />
          </label>
          <label>
            <span>Short name</span>
            <input className="input" name="shortTitle" defaultValue={group.shortTitle} />
          </label>
        </div>
        <label>
          <span>Central claim</span>
          <textarea name="centralClaim" defaultValue={group.centralClaim} />
        </label>
        <div className="atlasCategoryTwoCol">
          <label>
            <span>Group status</span>
            <select className="select" name="groupStatus" defaultValue={group.status}>
              {ATLAS_CATEGORY_GROUP_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <label>
            <span>Related group IDs</span>
            <textarea name="relatedGroupIds" defaultValue={linesToText(group.relatedGroupIds)} />
          </label>
        </div>
        <label>
          <span>Review notes</span>
          <textarea name="notes" defaultValue={group.notes} />
        </label>
        <button className="formBtn" type="submit">Save Category</button>
      </form>

      <ChunkSupport refs={groupRefs} chunkById={chunkById} />

      <div className="atlasCategoryMemberGrid">
        <div>
          <h3>Contributors</h3>
          {group.contributors.map(contributor => (
            <span key={contributor.id}>{contributor.name}<code>{contributor.id}</code></span>
          ))}
        </div>
        <div>
          <h3>Texts</h3>
          {group.texts.map(text => (
            <span key={text.id}>{text.title}<code>{text.id}</code></span>
          ))}
        </div>
      </div>

      <div className="atlasCategoryOperationGrid">
        <form action={applyAtlasCategoryOperation}>
          <HiddenCategoryFields mapId={mapId} referenceMapId={referenceMapId} groupId={group.id} operation="merge_groups" />
          <label>
            <span>Merge into</span>
            <select className="select" name="targetGroupId" defaultValue="">
              <option value="">Select target</option>
              {otherGroups.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </label>
          <input className="input" name="reason" placeholder="Why merge?" />
          <button className="resetBtn" type="submit">Merge</button>
        </form>

        <form action={applyAtlasCategoryOperation}>
          <HiddenCategoryFields mapId={mapId} referenceMapId={referenceMapId} groupId={group.id} operation="split_group" />
          <label>
            <span>Split off</span>
            <input className="input" name="newGroupTitle" placeholder="New group title" />
          </label>
          <label>
            <span>Moved contributor/text IDs</span>
            <textarea name="memberIds" placeholder="one id per line" />
          </label>
          <button className="resetBtn" type="submit">Split</button>
        </form>

        <form action={applyAtlasCategoryOperation}>
          <HiddenCategoryFields mapId={mapId} referenceMapId={referenceMapId} groupId={group.id} operation="move_member" />
          <div className="atlasCategoryTwoCol">
            <label>
              <span>Member type</span>
              <select className="select" name="memberType" defaultValue="contributor">
                <option value="contributor">Contributor</option>
                <option value="text">Text</option>
              </select>
            </label>
            <label>
              <span>Move ID</span>
              <input className="input" name="memberId" />
            </label>
          </div>
          <label>
            <span>Target group</span>
            <select className="select" name="targetGroupId" defaultValue="">
              <option value="">Select target</option>
              {otherGroups.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </label>
          <button className="resetBtn" type="submit">Move</button>
        </form>

        <div className="atlasCategoryMiniActions">
          <form action={applyAtlasCategoryOperation}>
            <HiddenCategoryFields mapId={mapId} referenceMapId={referenceMapId} groupId={group.id} operation="reorder_group" />
            <input type="hidden" name="direction" value="up" />
            <button className="resetBtn" type="submit">Move Up</button>
          </form>
          <form action={applyAtlasCategoryOperation}>
            <HiddenCategoryFields mapId={mapId} referenceMapId={referenceMapId} groupId={group.id} operation="reorder_group" />
            <input type="hidden" name="direction" value="down" />
            <button className="resetBtn" type="submit">Move Down</button>
          </form>
          <form action={applyAtlasCategoryOperation}>
            <HiddenCategoryFields mapId={mapId} referenceMapId={referenceMapId} groupId={group.id} operation="remove_group" />
            <input type="hidden" name="reason" value="Removed during category review." />
            <button className="resetBtn danger" type="submit">Remove</button>
          </form>
        </div>
      </div>
    </details>
  );
}

function HiddenCategoryFields({ mapId, referenceMapId, groupId, operation }: { mapId: string; referenceMapId: string; groupId: string; operation: string }) {
  return (
    <>
      <input type="hidden" name="mapId" value={mapId} />
      <input type="hidden" name="referenceMapId" value={referenceMapId} />
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="operation" value={operation} />
    </>
  );
}

function ChunkSupport({ refs, chunkById }: { refs: AtlasProvenanceRef[]; chunkById: Map<string, { heading: string; excerpt: string }> }) {
  const seen = new Set<string>();
  const chunks = refs
    .map(ref => ref.chunkId || `${ref.sourceId}#${ref.chunkIndex}`)
    .filter(chunkId => {
      if (!chunkId || seen.has(chunkId)) return false;
      seen.add(chunkId);
      return true;
    })
    .map(chunkId => ({ chunkId, chunk: chunkById.get(chunkId) }))
    .slice(0, 5);

  if (!chunks.length) return <div className="atlasSourceNotice">No provenance chunks attached.</div>;

  return (
    <div className="atlasCategoryChunks">
      {chunks.map(({ chunkId, chunk }) => (
        <article key={chunkId}>
          <code>{chunkId}</code>
          <strong>{chunk?.heading || "Source chunk"}</strong>
          {chunk?.excerpt && <p>{chunk.excerpt}</p>}
        </article>
      ))}
    </div>
  );
}

function CategoryComparison({
  generatedGroups,
  generatedMap,
  referenceMap,
}: {
  generatedGroups: AtlasCategoryDraftGroup[];
  generatedMap: AtlasAdminMapDetail;
  referenceMap: AtlasAdminMapDetail | null;
}) {
  if (!referenceMap) {
    return (
      <section className="atlasCategoryPanelBlock">
        <p className="kicker">Comparison</p>
        <h2>No reference selected</h2>
      </section>
    );
  }

  const generatedKeys = new Set(generatedGroups.map(group => normalizedLabel(group.title)));
  const referenceKeys = new Set(referenceMap.groups.map(group => normalizedLabel(group.title)));
  const missingGroups = referenceMap.groups.filter(group => !generatedKeys.has(normalizedLabel(group.title)));
  const extraGroups = generatedGroups.filter(group => !referenceKeys.has(normalizedLabel(group.title)));
  const generatedContributors = new Set(generatedGroups.flatMap(group => group.contributors.map(contributor => normalizedLabel(contributor.name))));
  const referenceContributors = new Set(referenceMap.groups.flatMap(group => group.contributors.map(contributor => normalizedLabel(contributor.name))));
  const missingContributors = [...referenceContributors].filter(name => !generatedContributors.has(name)).slice(0, 10);

  return (
    <section className="atlasCategoryPanelBlock">
      <p className="kicker">Comparison</p>
      <h2>{referenceMap.title}</h2>
      <div className="atlasCategoryCompareStats">
        <span><strong>{generatedGroups.length}</strong> generated groups</span>
        <span><strong>{referenceMap.groups.length}</strong> reference groups</span>
        <span><strong>{generatedMap.relations.length}</strong> generated relations</span>
        <span><strong>{referenceMap.relations.length}</strong> reference relations</span>
      </div>
      <DiffList title="Missing coverage" items={missingGroups.map(group => group.title)} />
      <DiffList title="Extra / redundant candidates" items={extraGroups.map(group => group.title)} />
      <DiffList title="Missing contributors" items={missingContributors.map(titleFromNormalized)} />
    </section>
  );
}

function DiffList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="atlasCategoryDiffList">
      <h3>{title}</h3>
      {items.length ? items.map(item => <span key={item}>{item}</span>) : <em>None flagged</em>}
    </div>
  );
}

function QualityScorecardForm({
  mapId,
  referenceMapId,
  scorecard,
}: {
  mapId: string;
  referenceMapId: string;
  scorecard: AtlasCategoryReviewState["scorecard"];
}) {
  const scores = scorecard || {
    categoryQuality: 3,
    fieldCoverage: 3,
    factualAccuracy: 3,
    contributorPlacement: 3,
    keyTextSelection: 3,
    objectionQuality: 3,
    relationQuality: 3,
    explanatoryUsefulness: 3,
    redundancyNoise: 3,
    provenanceSupport: 3,
    notes: "",
    updatedAt: "",
  };

  return (
    <form className="atlasCategoryPanelBlock atlasQualityScorecard" action={updateAtlasQualityScorecard}>
      <input type="hidden" name="mapId" value={mapId} />
      <input type="hidden" name="referenceMapId" value={referenceMapId} />
      <p className="kicker">Scorecard</p>
      <h2>Quality scores</h2>
      <div className="atlasScoreGrid">
        <ScoreSelect name="categoryQuality" label="Category quality" value={scores.categoryQuality} />
        <ScoreSelect name="fieldCoverage" label="Field coverage" value={scores.fieldCoverage} />
        <ScoreSelect name="factualAccuracy" label="Factual accuracy" value={scores.factualAccuracy} />
        <ScoreSelect name="contributorPlacement" label="Contributor placement" value={scores.contributorPlacement} />
        <ScoreSelect name="keyTextSelection" label="Key texts" value={scores.keyTextSelection} />
        <ScoreSelect name="objectionQuality" label="Objections" value={scores.objectionQuality} />
        <ScoreSelect name="relationQuality" label="Relations" value={scores.relationQuality} />
        <ScoreSelect name="explanatoryUsefulness" label="Usefulness" value={scores.explanatoryUsefulness} />
        <ScoreSelect name="redundancyNoise" label="Redundancy/noise" value={scores.redundancyNoise} />
        <ScoreSelect name="provenanceSupport" label="Provenance" value={scores.provenanceSupport} />
      </div>
      <label>
        <span>Notes</span>
        <textarea name="notes" defaultValue={scores.notes} />
      </label>
      <button className="formBtn" type="submit">Save Scores</button>
    </form>
  );
}

function ScoreSelect({ name, label, value }: { name: string; label: string; value: number }) {
  return (
    <label>
      <span>{label}</span>
      <select className="select" name={name} defaultValue={value}>
        {[1, 2, 3, 4, 5].map(score => <option key={score} value={score}>{score}</option>)}
      </select>
    </label>
  );
}

function CorrectionCapturePanel({
  mapId,
  referenceMapId,
  corrections,
}: {
  mapId: string;
  referenceMapId: string;
  corrections: AtlasCategoryReviewState["corrections"];
}) {
  return (
    <section className="atlasCategoryPanelBlock">
      <p className="kicker">Corrections</p>
      <h2>{corrections.length} captured</h2>
      <form className="atlasCorrectionForm" action={addAtlasReviewCorrection}>
        <input type="hidden" name="mapId" value={mapId} />
        <input type="hidden" name="referenceMapId" value={referenceMapId} />
        <div className="atlasCategoryTwoCol">
          <label><span>Entity type</span><input className="input" name="entityType" placeholder="group" /></label>
          <label><span>Entity ID</span><input className="input" name="entityId" /></label>
        </div>
        <div className="atlasCategoryTwoCol">
          <label><span>Field</span><input className="input" name="fieldName" placeholder="centralClaim" /></label>
          <label>
            <span>Type</span>
            <select className="select" name="correctionType" defaultValue="other">
              {ATLAS_CORRECTION_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
        </div>
        <label><span>Original value</span><textarea name="originalValue" /></label>
        <label><span>Revised value</span><textarea name="revisedValue" /></label>
        <label><span>Reason</span><textarea name="reason" /></label>
        <label>
          <span>Status</span>
          <select className="select" name="reviewerStatus" defaultValue="open">
            {ATLAS_CORRECTION_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <button className="resetBtn" type="submit">Add Correction</button>
      </form>

      <div className="atlasCorrectionList">
        {corrections.map(correction => (
          <article key={correction.id}>
            <strong>{correction.correctionType}</strong>
            <span>{correction.entityType} / {correction.entityId} / {correction.fieldName}</span>
            <p>{correction.reason}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function RecipeFeedbackPanel({
  feedback,
  recipeId,
}: {
  feedback: AtlasCategoryReviewState["recipeFeedback"];
  recipeId: string;
}) {
  if (!recipeId) return null;

  return (
    <section className="atlasCategoryPanelBlock">
      <p className="kicker">Recipe Feedback</p>
      <h2>{recipeId}</h2>
      {feedback.length === 0 && <div className="atlasSourceNotice">No recurring corrections recorded yet.</div>}
      {feedback.map(item => (
        <form className="atlasRecipeFeedbackForm" action={updateAtlasRecipeFeedback} key={item.id}>
          <input type="hidden" name="feedbackId" value={item.id} />
          <input type="hidden" name="recipeId" value={item.recipeId} />
          <input type="hidden" name="correctionType" value={item.correctionType} />
          <strong>{item.correctionType} / {item.evidenceCount} signals</strong>
          <label><span>Summary</span><textarea name="summary" defaultValue={item.summary} /></label>
          <label><span>Recommendation</span><textarea name="recommendation" defaultValue={item.recommendation} /></label>
          <label>
            <span>Status</span>
            <select className="select" name="status" defaultValue={item.status}>
              <option value="pending">pending</option>
              <option value="applied">applied</option>
              <option value="dismissed">dismissed</option>
            </select>
          </label>
          <button className="resetBtn" type="submit">Save Feedback</button>
        </form>
      ))}
    </section>
  );
}

function CategoryCheckpointPanel({
  mapId,
  referenceMapId,
  checkpointStatus,
}: {
  mapId: string;
  referenceMapId: string;
  checkpointStatus: string;
}) {
  return (
    <form className="atlasCategoryPanelBlock" action={approveAtlasCategoryCheckpoint}>
      <input type="hidden" name="mapId" value={mapId} />
      <input type="hidden" name="referenceMapId" value={referenceMapId} />
      <p className="kicker">Checkpoint</p>
      <h2>{checkpointStatus}</h2>
      <label>
        <span>Approval notes</span>
        <textarea name="reviewerNotes" />
      </label>
      <button className="formBtn" type="submit">Approve Categories</button>
    </form>
  );
}

function SelectedMapEditor({ map }: { map: AtlasAdminMapDetail }) {
  const groupTitleById = new Map(map.groups.map(group => [group.id, group.shortTitle || group.title]));

  return (
    <section className="atlasAdminEditor" aria-label={`${map.title} editor`}>
      <form className="adminPanel atlasAdminMapForm" action={updateAtlasMap}>
        <input type="hidden" name="mapId" value={map.id} />

        <div className="atlasAdminPanelTop">
          <div>
            <p className="kicker">{map.territoryTitle} / {map.branchTitle}</p>
            <h2>{map.title}</h2>
          </div>
          <button className="formBtn" type="submit">Save Map</button>
        </div>

        <div className="atlasAdminMetaGrid">
          <div><span>ID</span><code>{map.id}</code></div>
          <div><span>Slug</span><code>{map.slug}</code></div>
          <div><span>Atlas state</span><code>{map.atlasStatus}</code></div>
          <div><span>Build</span><code>{map.buildMode}</code></div>
          <div><span>Updated</span><code>{formatDate(map.updatedAt)}</code></div>
        </div>

        <div className="atlasAdminFormGrid">
          <label>
            <span>Map title</span>
            <input className="input" name="title" defaultValue={map.title} />
          </label>
          <label>
            <span>Review status</span>
            <select className="select" name="reviewStatus" defaultValue={map.reviewStatus}>
              {ATLAS_REVIEW_STATUSES.map(status => (
                <option value={status} key={status}>{REVIEW_STATUS_LABELS[status]}</option>
              ))}
            </select>
          </label>
        </div>

        <label>
          <span>Map summary</span>
          <textarea name="summary" defaultValue={map.summary} />
        </label>
      </form>

      <section className="atlasAdminStructure">
        <div className="atlasAdminColumn">
          <header className="atlasAdminSectionHeader">
            <div>
              <p className="kicker">Families</p>
              <h2>{map.groups.length} groups</h2>
            </div>
          </header>
          {map.groups.map((group, index) => <GroupEditor group={group} mapId={map.id} key={group.id} open={index === 0} />)}
        </div>

        <aside className="atlasAdminColumn atlasAdminRelations">
          <header className="atlasAdminSectionHeader">
            <div>
              <p className="kicker">Relations</p>
              <h2>{map.relations.length} links</h2>
            </div>
          </header>

          {map.relations.map(relation => (
            <form className="atlasAdminRelationCard" action={updateAtlasRelation} key={relation.id}>
              <input type="hidden" name="mapId" value={map.id} />
              <input type="hidden" name="relationId" value={relation.id} />
              <div>
                <strong>{groupTitleById.get(relation.source) || relation.source}</strong>
                <span>{relation.kind}</span>
                <strong>{groupTitleById.get(relation.target) || relation.target}</strong>
              </div>
              <label>
                <span>Relation note</span>
                <textarea name="note" defaultValue={relation.note} />
              </label>
              <ProvenanceChips refs={relation.provenance} label={`${relation.id} provenance`} />
              <button className="resetBtn" type="submit">Save Relation</button>
            </form>
          ))}
        </aside>
      </section>
    </section>
  );
}

function GroupEditor({ group, mapId, open }: { group: AtlasAdminGroup; mapId: string; open: boolean }) {
  return (
    <details className="atlasAdminGroupCard" open={open}>
      <summary>
        <span>
          <strong>{group.title}</strong>
          <small>{group.family} / {group.contributors.length} contributors</small>
        </span>
      </summary>

      <ProvenanceChips refs={group.provenance} label={`${group.title} provenance`} />

      <form className="atlasAdminGroupForm" action={updateAtlasGroup}>
        <input type="hidden" name="mapId" value={mapId} />
        <input type="hidden" name="groupId" value={group.id} />

        <label>
          <span>Explanatory stance</span>
          <textarea name="stance" defaultValue={group.stance} />
        </label>

        <label>
          <span>Central claim</span>
          <textarea name="centralClaim" defaultValue={group.centralClaim} />
        </label>

        <label>
          <span>Why it matters</span>
          <textarea name="whyItMatters" defaultValue={group.whyItMatters} />
        </label>

        <label>
          <span>Objections / pressure points</span>
          <textarea name="objections" defaultValue={linesToText(group.objections)} />
        </label>

        <button className="formBtn" type="submit">Save Family</button>
      </form>

      <section className="atlasAdminContributorStack" aria-label={`${group.title} contributors`}>
        {group.contributors.map(contributor => (
          <article className="atlasAdminContributorCard" key={contributor.id}>
            <header>
              <div>
                <strong>{contributor.name}</strong>
                <span>{contributor.role}</span>
              </div>
              <code>{contributor.id}</code>
            </header>

            <ProvenanceChips refs={contributor.provenance} label={`${contributor.name} provenance`} />

            <div className="atlasAdminTextChips" aria-label="Key texts">
              {contributor.texts.map(text => (
                <span key={text.id}>
                  {text.title}
                  {text.provenance.length > 0 && <em>{provenanceSummary(text.provenance)}</em>}
                </span>
              ))}
            </div>

            <form action={updateAtlasContributor}>
              <input type="hidden" name="mapId" value={mapId} />
              <input type="hidden" name="groupId" value={group.id} />
              <input type="hidden" name="contributorId" value={contributor.id} />
              <label>
                <span>Reason / importance</span>
                <textarea name="reason" defaultValue={contributor.reason} />
              </label>
              <button className="resetBtn" type="submit">Save Contributor</button>
            </form>
          </article>
        ))}
      </section>
    </details>
  );
}

function ProvenanceChips({ refs, label }: { refs: AtlasProvenanceRef[]; label: string }) {
  if (!refs.length) return null;

  return (
    <div className="atlasProvenanceChips" aria-label={label}>
      {refs.map((ref, index) => (
        <code key={`${ref.sourceId}-${ref.chunkIndex}-${index}`}>{provenanceLabel(ref)}</code>
      ))}
    </div>
  );
}

function provenanceSummary(refs: AtlasProvenanceRef[]) {
  return refs.map(provenanceLabel).join(", ");
}

function provenanceLabel(ref: AtlasProvenanceRef) {
  return ref.chunkId || `${ref.sourceId}#${ref.chunkIndex}`;
}

function sourceMatchesPlannedMap(source: AtlasAdminSourceItem, plannedMap: AtlasPlannedMapItem) {
  if (source.territorySlug !== plannedMap.territorySlug) return false;
  if (source.branchSlug !== plannedMap.branchSlug) return false;
  return !source.mapSlug || source.mapSlug === plannedMap.mapSlug;
}

function draftGroupsForView(map: AtlasAdminMapDetail): AtlasCategoryDraftGroup[] {
  return map.groups.map((group, index) => {
    const texts = group.contributors.flatMap(contributor => contributor.texts.map(text => ({
      id: text.id,
      title: text.title,
      contributorId: contributor.id,
      provenance: text.provenance,
    })));

    return {
      id: group.id,
      title: group.title,
      shortTitle: group.shortTitle,
      description: group.stance,
      centralClaim: group.centralClaim,
      relatedGroupIds: group.relatedGroupIds,
      status: "uncertain",
      notes: "",
      displayOrder: index,
      contributors: group.contributors.map(contributor => ({
        id: contributor.id,
        name: contributor.name,
        provenance: contributor.provenance,
        texts: contributor.texts.map(text => ({
          id: text.id,
          title: text.title,
          contributorId: contributor.id,
          provenance: text.provenance,
        })),
      })),
      texts,
      provenance: group.provenance,
    };
  });
}

function normalizedLabel(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|and|of|metaphysics|family|families)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFromNormalized(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatDate(value: string) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function paramArray(value: string | string[] | undefined) {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value])
    .flatMap(item => String(item).split(","))
    .map(item => item.trim())
    .filter(Boolean);
}

function linesFromParam(value: string | string[] | undefined) {
  return paramArray(value)
    .flatMap(item => item.split(/\r?\n/))
    .map(item => item.trim())
    .filter(Boolean);
}

function savedLabel(value: string) {
  if (value === "map") return "map metadata";
  if (value === "group") return "family";
  if (value === "contributor") return "contributor";
  if (value === "relation") return "relation";
  if (value === "category") return "category review";
  if (value === "category-operation") return "category operation";
  if (value === "scorecard") return "quality scorecard";
  if (value === "correction") return "review correction";
  if (value === "recipe-feedback") return "recipe feedback";
  if (value === "category-checkpoint") return "category checkpoint";
  return "Atlas";
}
