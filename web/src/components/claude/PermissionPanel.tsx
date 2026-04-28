import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useMemo, useState } from "react";
import { Check, ShieldAlert, X } from "lucide-react";
import type {
  AskUserQuestion,
  AskUserQuestionOption,
  PendingPermission,
} from "../../features/chat/types";

type RespondOptions = {
  updatedInput?: Record<string, unknown>;
  message?: string;
};

type Props = {
  requests: PendingPermission[];
  onRespond: (
    requestId: string,
    approved: boolean,
    options?: RespondOptions,
  ) => void | Promise<void>;
};

type PlanPromptRequest = {
  tool: string;
  prompt: string;
};

function summarizeInput(input: Record<string, unknown>): string | null {
  const serialized = JSON.stringify(input);
  if (!serialized || serialized === "{}") return null;
  return serialized.length > 120 ? `${serialized.slice(0, 120)}...` : serialized;
}

function buildAskUserAnswers(
  questions: AskUserQuestion[],
  answers: Record<string, string | string[]>,
  notes: Record<string, string>,
): {
  answers: Record<string, string>;
  annotations?: Record<string, { preview?: string; notes?: string }>;
} {
  const normalizedAnswers: Record<string, string> = {};
  const annotations: Record<string, { preview?: string; notes?: string }> = {};

  questions.forEach((question) => {
    const current = answers[question.question];
    if (!current) return;
    normalizedAnswers[question.question] = Array.isArray(current)
      ? current.join(", ")
      : current;

    const selectedLabels = Array.isArray(current) ? current : [current];
    const preview = question.options.find((option) => selectedLabels.includes(option.label))?.preview;
    const note = notes[question.question]?.trim();
    if (preview || note) {
      annotations[question.question] = {
        ...(preview ? { preview } : {}),
        ...(note ? { notes: note } : {}),
      };
    }
  });

  return {
    answers: normalizedAnswers,
    ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
  };
}

function AskUserRequestCard({
  request,
  onRespond,
}: {
  request: PendingPermission;
  onRespond: Props["onRespond"];
}) {
  const questions = useMemo(
    () => ((request.toolInput.questions as AskUserQuestion[] | undefined) ?? []),
    [request.toolInput.questions],
  );
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [activeQuestion, setActiveQuestion] = useState(0);

  if (questions.length === 0) {
    return (
      <GenericPermissionCard
        request={request}
        onApprove={() => void onRespond(request.requestId, true)}
        onReject={() => void onRespond(request.requestId, false)}
      />
    );
  }

  const currentQuestion = questions[activeQuestion] ?? questions[0];
  const currentAnswer = answers[currentQuestion.question];
  const allQuestionsAnswered = questions.every((question) => {
    const value = answers[question.question];
    return Array.isArray(value) ? value.length > 0 : Boolean(value?.trim());
  });

  function toggleOption(question: AskUserQuestion, option: AskUserQuestionOption) {
    setAnswers((prev) => {
      const existing = prev[question.question];
      if (question.multiSelect) {
        const current = Array.isArray(existing)
          ? existing
          : existing
            ? [existing]
            : [];
        const next = current.includes(option.label)
          ? current.filter((item) => item !== option.label)
          : [...current, option.label];
        return { ...prev, [question.question]: next };
      }
      return { ...prev, [question.question]: option.label };
    });
  }

  function commitCustomAnswer(question: AskUserQuestion) {
    const value = customAnswers[question.question]?.trim();
    if (!value) return;
    setAnswers((prev) => ({ ...prev, [question.question]: value }));
    setCustomAnswers((prev) => ({ ...prev, [question.question]: "" }));
  }

  const selectedPreview = currentQuestion.options.find((option) => {
    if (Array.isArray(currentAnswer)) return currentAnswer.includes(option.label);
    return currentAnswer === option.label;
  })?.preview;

  const payload = buildAskUserAnswers(questions, answers, notes);

  return (
    <div className="rounded-xl border border-[#efcfad] bg-[#fff8ee] px-4 py-3 text-near-black">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#f6e3c7] text-[#a15a1d]">
          <ShieldAlert className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[#8f4f1a]">
            Claude needs answers from you
          </div>
          <div className="mt-1 text-xs leading-5 text-charcoal-warm">
            {request.description || "Answer the structured questions below so Claude can continue."}
          </div>

          {questions.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {questions.map((question, index) => (
                <button
                  key={question.question}
                  type="button"
                  onClick={() => setActiveQuestion(index)}
                  className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                    activeQuestion === index
                      ? "bg-terracotta text-white"
                      : "bg-white text-charcoal-warm border border-[#dfc29d]"
                  }`}
                >
                  {question.header || `Q${index + 1}`}
                </button>
              ))}
            </div>
          )}

          <div className="mt-3 rounded-xl border border-[#ead4ba] bg-white/80 p-3">
            <div className="text-sm font-medium text-near-black">
              {currentQuestion.question}
            </div>
            <div className="mt-3 space-y-2">
              {currentQuestion.options.map((option) => {
                const selected = Array.isArray(currentAnswer)
                  ? currentAnswer.includes(option.label)
                  : currentAnswer === option.label;
                return (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => toggleOption(currentQuestion, option)}
                    className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      selected
                        ? "border-terracotta bg-[#fff4ec]"
                        : "border-[#eadfce] bg-white hover:bg-[#faf6ef]"
                    }`}
                  >
                    <div className="text-sm font-medium text-near-black">
                      {option.label}
                    </div>
                    {option.description && (
                      <div className="mt-0.5 text-xs leading-5 text-charcoal-warm">
                        {option.description}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={customAnswers[currentQuestion.question] || ""}
                onChange={(event) =>
                  setCustomAnswers((prev) => ({
                    ...prev,
                    [currentQuestion.question]: event.target.value,
                  }))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitCustomAnswer(currentQuestion);
                  }
                }}
                placeholder="Other answer..."
                className="min-w-0 flex-1 rounded-lg border border-[#dfc29d] bg-white px-3 py-2 text-sm outline-none focus:border-terracotta"
              />
              <button
                type="button"
                onClick={() => commitCustomAnswer(currentQuestion)}
                className="rounded-lg border border-[#dfc29d] bg-white px-3 py-2 text-xs font-medium text-charcoal-warm hover:bg-[#fbf2e4]"
              >
                Use
              </button>
            </div>

            <textarea
              value={notes[currentQuestion.question] || ""}
              onChange={(event) =>
                setNotes((prev) => ({
                  ...prev,
                  [currentQuestion.question]: event.target.value,
                }))
              }
              placeholder="Optional note for Claude..."
              rows={3}
              className="mt-3 w-full rounded-lg border border-[#dfc29d] bg-white px-3 py-2 text-sm outline-none focus:border-terracotta"
            />

            {selectedPreview && (
              <pre className="mt-3 overflow-x-auto rounded-lg border border-[#eadfce] bg-[#fdfaf4] px-3 py-2 text-[11px] leading-5 text-charcoal-warm whitespace-pre-wrap">
                {selectedPreview}
              </pre>
            )}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                void onRespond(request.requestId, true, {
                  updatedInput: {
                    ...request.toolInput,
                    ...payload,
                  },
                })
              }
              disabled={!allQuestionsAnswered}
              className="inline-flex items-center gap-1.5 rounded-lg bg-terracotta px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#c86a4b] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Check className="h-3.5 w-3.5" />
              Submit answers
            </button>
            <button
              type="button"
              onClick={() =>
                void onRespond(request.requestId, false, {
                  message: "The user skipped the structured question flow.",
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#dfc29d] bg-white px-3 py-2 text-xs font-medium text-charcoal-warm transition-colors hover:bg-[#fbf2e4]"
            >
              <X className="h-3.5 w-3.5" />
              Skip
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExitPlanRequestCard({
  request,
  onRespond,
}: {
  request: PendingPermission;
  onRespond: Props["onRespond"];
}) {
  const originalPlan =
    typeof request.toolInput.plan === "string" ? request.toolInput.plan : "";
  const planFilePath =
    typeof request.toolInput.planFilePath === "string"
      ? request.toolInput.planFilePath
      : "";
  const allowedPrompts = useMemo(
    () =>
      Array.isArray(request.toolInput.allowedPrompts)
        ? request.toolInput.allowedPrompts.filter(
            (item): item is PlanPromptRequest =>
              Boolean(item) &&
              typeof item === "object" &&
              typeof (item as { tool?: unknown }).tool === "string" &&
              typeof (item as { prompt?: unknown }).prompt === "string",
          )
        : [],
    [request.toolInput.allowedPrompts],
  );
  const [editablePlan, setEditablePlan] = useState(originalPlan);
  const [feedback, setFeedback] = useState("");
  const trimmedPlan = editablePlan.trim();
  const wasEdited = editablePlan !== originalPlan;

  return (
    <div className="rounded-xl border border-[#efcfad] bg-[#fff8ee] px-4 py-3 text-near-black">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#f6e3c7] text-[#a15a1d]">
          <ShieldAlert className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[#8f4f1a]">
            Review plan
          </div>
          <div className="mt-1 text-xs leading-5 text-charcoal-warm">
            {request.description || "Claude is asking for approval before leaving plan mode."}
          </div>
          {planFilePath && (
            <div className="mt-3 rounded-lg border border-[#ead4ba] bg-white/80 px-3 py-2 text-[11px] text-charcoal-warm">
              Plan file: <span className="font-mono">{planFilePath}</span>
            </div>
          )}
          {allowedPrompts.length > 0 && (
            <div className="mt-3 rounded-xl border border-[#ead4ba] bg-white/80 px-3 py-2 text-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-[#8f4f1a]">
                Requested execution permissions
              </div>
              <div className="mt-2 space-y-1.5 text-xs text-charcoal-warm">
                {allowedPrompts.map((item) => (
                  <div
                    key={`${item.tool}:${item.prompt}`}
                    className="rounded-lg bg-[#fdf7ee] px-2.5 py-2"
                  >
                    <span className="font-medium text-near-black">{item.tool}</span>
                    <span className="text-stone-gray"> · </span>
                    <span>{item.prompt}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="mt-3">
            <label
              htmlFor={`plan-editor-${request.requestId}`}
              className="text-xs font-semibold uppercase tracking-wide text-[#8f4f1a]"
            >
              Plan draft
            </label>
            <textarea
              id={`plan-editor-${request.requestId}`}
              aria-label="Plan draft"
              value={editablePlan}
              onChange={(event) => setEditablePlan(event.target.value)}
              placeholder="Edit the plan before approving if needed..."
              rows={10}
              className="mt-2 w-full rounded-lg border border-[#dfc29d] bg-white px-3 py-2 font-mono text-[12px] leading-5 outline-none focus:border-terracotta"
            />
            <div className="mt-2 text-[11px] text-stone-gray">
              Approving will send this exact plan back to Claude for implementation.
              {wasEdited ? " Edited locally in web." : ""}
            </div>
          </div>
          {trimmedPlan && (
            <div className="mt-3 rounded-xl border border-[#ead4ba] bg-white/80 px-3 py-2 text-sm">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#8f4f1a]">
                Preview
              </div>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{trimmedPlan}</ReactMarkdown>
            </div>
          )}
          <div className="mt-3">
            <label
              htmlFor={`plan-feedback-${request.requestId}`}
              className="text-xs font-semibold uppercase tracking-wide text-[#8f4f1a]"
            >
              Revision feedback
            </label>
            <textarea
              id={`plan-feedback-${request.requestId}`}
              aria-label="Revision feedback"
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder="What should Claude change before trying the plan again?"
              rows={4}
              className="mt-2 w-full rounded-lg border border-[#dfc29d] bg-white px-3 py-2 text-sm outline-none focus:border-terracotta"
            />
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                void onRespond(request.requestId, true, {
                  updatedInput: {
                    ...request.toolInput,
                    ...(trimmedPlan ? { plan: trimmedPlan } : {}),
                  },
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-terracotta px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#c86a4b]"
            >
              <Check className="h-3.5 w-3.5" />
              Approve plan
            </button>
            <button
              type="button"
              onClick={() =>
                void onRespond(request.requestId, false, {
                  message: feedback.trim() || "Please revise the proposed plan.",
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#dfc29d] bg-white px-3 py-2 text-xs font-medium text-charcoal-warm transition-colors hover:bg-[#fbf2e4]"
            >
              <X className="h-3.5 w-3.5" />
              Request changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GenericPermissionCard({
  request,
  onApprove,
  onReject,
}: {
  request: PendingPermission;
  onApprove: () => void;
  onReject: () => void;
}) {
  const inputSummary = summarizeInput(request.toolInput);

  return (
    <div className="rounded-xl border border-[#efcfad] bg-[#fff8ee] px-4 py-3 text-near-black">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#f6e3c7] text-[#a15a1d]">
          <ShieldAlert className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[#8f4f1a]">
            Permission required
          </div>
          <div className="mt-1 text-sm font-medium">
            {request.toolName}
          </div>
          {request.description && (
            <div className="mt-1 text-xs leading-5 text-charcoal-warm">
              {request.description}
            </div>
          )}
          {inputSummary && (
            <pre className="mt-2 overflow-x-auto rounded-lg bg-white/80 px-3 py-2 text-[11px] leading-5 text-charcoal-warm">
              {inputSummary}
            </pre>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onApprove}
            className="inline-flex items-center gap-1.5 rounded-lg bg-terracotta px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#c86a4b]"
          >
            <Check className="h-3.5 w-3.5" />
            Allow
          </button>
          <button
            type="button"
            onClick={onReject}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#dfc29d] bg-white px-3 py-2 text-xs font-medium text-charcoal-warm transition-colors hover:bg-[#fbf2e4]"
          >
            <X className="h-3.5 w-3.5" />
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}

function renderRequest(
  request: PendingPermission,
  onRespond: Props["onRespond"],
) {
  if (request.toolName === "AskUserQuestion") {
    return <AskUserRequestCard request={request} onRespond={onRespond} />;
  }

  if (request.toolName === "ExitPlanMode" || request.toolName === "ExitPlanModeV2") {
    return <ExitPlanRequestCard request={request} onRespond={onRespond} />;
  }

  return (
    <GenericPermissionCard
      request={request}
      onApprove={() => void onRespond(request.requestId, true)}
      onReject={() => void onRespond(request.requestId, false)}
    />
  );
}

export function PermissionPanel({ requests, onRespond }: Props) {
  if (requests.length === 0) return null;

  return (
    <div className="space-y-3">
      {requests.map((request) => (
        <div key={request.requestId}>
          {renderRequest(request, onRespond)}
        </div>
      ))}
    </div>
  );
}
