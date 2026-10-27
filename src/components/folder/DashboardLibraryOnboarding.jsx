import React from 'react';
import { motion } from 'motion/react';
import { FaIcon } from '../FaIcon';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import '../../styles/DashboardOnboarding.css';

export function DashboardLibraryOnboarding({ t, onOpenLibrarySettings }) {
    const reducedMotion = useReducedMotion();
    const steps = ['folder', 'save', 'read'];
    const features = [
        { key: 'recommendation', icon: 'shuffle', title: 'dashboard_recommendation' },
        { key: 'continue', icon: 'bookOpen', title: 'dashboard_continue' },
        { key: 'journal', icon: 'calendar', title: 'dashboard_setup_journal' },
    ];

    return <div className="dashboard-onboarding">
        <section className="reading-dashboard-welcome dashboard-onboarding-hero" aria-labelledby="dashboard-setup-title">
            <div className="dashboard-onboarding-intro">
                <span className="dashboard-onboarding-eyebrow">{t('reading_lists.dashboard_setup_eyebrow')}</span>
                <h2 id="dashboard-setup-title">{t('reading_lists.dashboard_setup_title')}</h2>
                <p>{t('reading_lists.dashboard_empty_description')}</p>
                <button type="button" className="reading-dashboard-settings is-setup-needed"
                    onClick={() => onOpenLibrarySettings?.({ focus: 'library-setup' })}>
                    <motion.span className="reading-dashboard-setup-glow" aria-hidden="true" initial={false}
                        animate={{ opacity: reducedMotion ? 0.45 : [0.12, 0.85, 0.12] }}
                        transition={{ duration: reducedMotion ? 0 : 3.8, repeat: reducedMotion ? 0 : Infinity, ease: 'easeInOut' }} />
                    <FaIcon name="folderOpen" />{t('reading_lists.dashboard_library_settings')}<FaIcon name="angleRight" size={12} />
                </button>
                <span className="dashboard-onboarding-reassurance">{t('reading_lists.dashboard_setup_reassurance')}</span>
            </div>
            <div className="dashboard-onboarding-art" aria-hidden="true">
                <span className="dashboard-onboarding-orbit" />
                <span className="dashboard-onboarding-book is-sage"><span /><span /><span /></span>
                <span className="dashboard-onboarding-book is-navy"><span /><span /><span /></span>
                <span className="dashboard-onboarding-book is-gold"><FaIcon name="bookOpen" size={36} /><span /><span /></span>
                <span className="dashboard-onboarding-shelf" />
            </div>
            <ol className="dashboard-onboarding-steps" aria-label={t('reading_lists.dashboard_setup_steps')}>
                {steps.map((step, index) => <li key={step} aria-current={index === 0 ? 'step' : undefined}>
                    <span className="dashboard-onboarding-step-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                    <div><h3>{t(`reading_lists.dashboard_setup_${step}`)}</h3><p>{t(`reading_lists.dashboard_setup_${step}_hint`)}</p></div>
                </li>)}
            </ol>
        </section>
        <section className="dashboard-onboarding-preview" aria-labelledby="dashboard-setup-preview-title">
            <h2 id="dashboard-setup-preview-title">{t('reading_lists.dashboard_setup_preview')}</h2>
            <div className="dashboard-onboarding-features">
                {features.map(feature => <div className="dashboard-onboarding-feature" key={feature.key}>
                    <span className="dashboard-onboarding-feature-icon" aria-hidden="true"><FaIcon name={feature.icon} size={18} /></span>
                    <div><h3>{t(`reading_lists.${feature.title}`)}</h3><p>{t(`reading_lists.dashboard_setup_${feature.key}_hint`)}</p></div>
                </div>)}
            </div>
        </section>
    </div>;
}
