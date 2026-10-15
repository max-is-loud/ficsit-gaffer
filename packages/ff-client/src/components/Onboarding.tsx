// First-run wizard that collects the foreman personality and the pioneer profile,
// then hands both strings to the parent to create the first foreman and
// playthrough.

import { useState } from 'react';

import { PIONEER_QUESTIONS, composeProfile, type ForemanPreset } from '../foremanPresets.js';
import { ForemanPresetGrid } from './ForemanPresetGrid.js';
import { PioneerQuestions } from './PioneerProfile.js';

type Step = 'welcome' | 'personality' | 'pioneer' | 'review';

const STEP_ORDER: Step[] = ['welcome', 'personality', 'pioneer', 'review'];

interface OnboardingProps {
  onComplete: (input: { personality: string; pioneerProfile: string }) => Promise<void>;
}

/**
 * First-run onboarding (GUI v1). Walks the pioneer through choosing the
 * foreman's personality and describing themselves, then hands both freeform
 * strings to onboarding (which mints a foreman + playthrough). Personality and
 * profile are both editable later via Settings — this is only the first pass.
 */
export function Onboarding({ onComplete }: OnboardingProps): React.JSX.Element {
  const [step, setStep] = useState<Step>('welcome');
  const [presetKey, setPresetKey] = useState<string | null>(null);
  const [personality, setPersonality] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [pioneerProfile, setPioneerProfile] = useState('');
  const [profileEdited, setProfileEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stepIndex = STEP_ORDER.indexOf(step);

  const choosePreset = (preset: ForemanPreset): void => {
    setPresetKey(preset.key);
    setPersonality(preset.seed);
  };

  const answerQuestion = (questionId: string, optionKey: string): void => {
    setAnswers((prev) => ({ ...prev, [questionId]: optionKey }));
  };

  // Moving from the pioneer step to review composes the profile, unless the
  // pioneer has already hand-edited it (don't clobber their wording).
  const goToReview = (): void => {
    if (!profileEdited) {
      setPioneerProfile(composeProfile(answers));
    }
    setStep('review');
  };

  const back = (): void => {
    const previous = STEP_ORDER[stepIndex - 1];
    if (previous !== undefined) {
      setStep(previous);
    }
  };

  const allAnswered = PIONEER_QUESTIONS.every((q) => answers[q.id] !== undefined);
  const canStart = personality.trim().length > 0 && pioneerProfile.trim().length > 0;

  const start = async (): Promise<void> => {
    if (!canStart) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onComplete({
        personality: personality.trim(),
        pioneerProfile: pioneerProfile.trim(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start your playthrough.');
      setSubmitting(false);
    }
  };

  return (
    <div className="onboarding">
      <div className="onboarding-shell">
        <div className="onboarding-top">
          <div className="wordmark">
            <span className="glyph" aria-hidden="true" />
            FOREMAN
          </div>
          {step !== 'welcome' ? (
            <span className="label onboarding-progress">
              Step {stepIndex} / {STEP_ORDER.length - 1}
            </span>
          ) : null}
        </div>

        {step === 'welcome' ? (
          <section className="onboarding-step">
            <h1 className="onboarding-title">Reporting for duty.</h1>
            <p className="onboarding-lede">
              Your foreman keeps the maths off your plate and the work moving — issuing achievable
              orders built from your game&apos;s real data, tracking what you finish, and adapting
              when the floor changes.
            </p>
            <p className="onboarding-lede">
              Two quick questions before the first shift: who your foreman is, and who you are.
            </p>
            <div className="onboarding-actions">
              <button type="button" className="send" onClick={() => setStep('personality')}>
                Begin
              </button>
            </div>
          </section>
        ) : null}

        {step === 'personality' ? (
          <section className="onboarding-step">
            <span className="label">Foreman personality</span>
            <h2 className="onboarding-heading">Who is your foreman?</h2>
            <p className="onboarding-lede">
              Pick a starting character, then make it your own. This voice colours every message —
              there is no wrong answer, and you can change it any time.
            </p>

            <ForemanPresetGrid selectedKey={presetKey} onChoose={choosePreset} />

            <div className="field">
              <label htmlFor="ob-personality">Personality (edit freely)</label>
              <textarea
                id="ob-personality"
                value={personality}
                onChange={(e) => {
                  setPersonality(e.target.value);
                  setPresetKey(null);
                }}
                placeholder="e.g. Gruff, no-nonsense shift boss who respects competence and hates wasted time."
              />
            </div>

            <div className="onboarding-actions">
              <button type="button" className="icon-button" onClick={back}>
                Back
              </button>
              <button
                type="button"
                className="send"
                onClick={() => setStep('pioneer')}
                disabled={personality.trim().length === 0}
              >
                Next
              </button>
            </div>
          </section>
        ) : null}

        {step === 'pioneer' ? (
          <section className="onboarding-step">
            <span className="label">Pioneer profile</span>
            <h2 className="onboarding-heading">And who are you?</h2>
            <p className="onboarding-lede">
              This sets the register — how the foreman applies its character to you. The voice stays
              the same; the pitch adapts.
            </p>

            <PioneerQuestions answers={answers} onAnswer={answerQuestion} />

            <div className="onboarding-actions">
              <button type="button" className="icon-button" onClick={back}>
                Back
              </button>
              <button type="button" className="send" onClick={goToReview} disabled={!allAnswered}>
                Next
              </button>
            </div>
          </section>
        ) : null}

        {step === 'review' ? (
          <section className="onboarding-step">
            <span className="label">Review</span>
            <h2 className="onboarding-heading">Confirm the brief.</h2>
            <p className="onboarding-lede">
              Tidy either of these in your own words before you start. Both stay editable in
              Settings.
            </p>

            <div className="field">
              <label htmlFor="ob-review-personality">Foreman personality</label>
              <textarea
                id="ob-review-personality"
                value={personality}
                onChange={(e) => setPersonality(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="ob-review-profile">Pioneer profile</label>
              <textarea
                id="ob-review-profile"
                value={pioneerProfile}
                onChange={(e) => {
                  setPioneerProfile(e.target.value);
                  setProfileEdited(true);
                }}
              />
            </div>

            {error !== null ? <p className="err">{error}</p> : null}

            <div className="onboarding-actions">
              <button type="button" className="icon-button" onClick={back}>
                Back
              </button>
              <button
                type="button"
                className="send"
                onClick={() => void start()}
                disabled={!canStart || submitting}
              >
                {submitting ? 'Starting' : 'Start shift'}
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
