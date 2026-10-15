// The pioneer play-style questions as segmented selects (PioneerQuestions), plus
// an editor (PioneerProfileFields) that composes the answers into editable
// profile text. Question definitions live in foremanPresets.

import { useState } from 'react';

import { PIONEER_QUESTIONS, composeProfile } from '../foremanPresets.js';

interface PioneerQuestionsProps {
  /** Selected option key per question id. */
  answers: Record<string, string>;
  onAnswer: (questionId: string, optionKey: string) => void;
}

/** The pioneer-profile questions as segmented single-selects. Shared by
 * onboarding (which composes on a later step) and {@link PioneerProfileFields}
 * (which composes live). Purely presentational. */
export function PioneerQuestions({ answers, onAnswer }: PioneerQuestionsProps): React.JSX.Element {
  return (
    <>
      {PIONEER_QUESTIONS.map((q) => (
        <div className="question" key={q.id}>
          <span className="label question-prompt">{q.prompt}</span>
          <div className="segmented" role="group" aria-label={q.prompt}>
            {q.options.map((option) => (
              <button
                type="button"
                key={option.key}
                className={`segment${answers[q.id] === option.key ? ' selected' : ''}`}
                onClick={() => onAnswer(q.id, option.key)}
                aria-pressed={answers[q.id] === option.key}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

interface PioneerProfileFieldsProps {
  /** The composed/edited profile string (controlled by the parent). */
  value: string;
  onChange: (value: string) => void;
}

/**
 * A controlled pioneer-profile editor: the same questions used at onboarding,
 * plus the editable composed text. Answering a question rebuilds the text from
 * all current answers; the pioneer can then refine the wording by hand. Used in
 * Settings (Pioneer section) and the new-playthrough modal so the profile is
 * configured the same way everywhere.
 *
 * An existing freeform profile (e.g. one written before this editor) can't be
 * reverse-mapped to answers, so the questions start unselected and the current
 * text is shown as-is; picking answers replaces it.
 */
export function PioneerProfileFields({
  value,
  onChange,
}: PioneerProfileFieldsProps): React.JSX.Element {
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const answer = (questionId: string, optionKey: string): void => {
    const next = { ...answers, [questionId]: optionKey };
    setAnswers(next);
    onChange(composeProfile(next));
  };

  return (
    <>
      <PioneerQuestions answers={answers} onAnswer={answer} />
      <div className="field">
        <label htmlFor="pioneer-profile">Pioneer profile (edit freely)</label>
        <textarea
          id="pioneer-profile"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Pick the options above, or describe your play style in your own words."
        />
      </div>
    </>
  );
}
