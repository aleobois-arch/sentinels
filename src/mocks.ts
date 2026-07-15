// Canned agent responses used when MOCK_QWEN=1, so the full pipeline
// (including the human-in-the-loop approval flow) can be demoed offline
// without a DashScope key and without spending API credits.

const MOCKS: Record<string, string> = {
  sentinelle: JSON.stringify({
    severity: 'P1',
    service: 'api-paiements',
    impact: 'Transactions bancaires bloquees pour ~68% des utilisateurs. SLA 99.9% menace.',
    classification:
      'Incident critique de production sur le service api-paiements: taux d\'erreur HTTP 500 superieur a 40% depuis 14 minutes. Correlation probable avec le deploiement v2.14.3.',
    perimetre: 'Clients e-commerce France + Belgique, passerelle PSP, estimation 12k EUR/min de CA bloque.',
    normalizedMessage: 'Taux d\'erreur 5xx > 40% sur api-paiements depuis 12:02 UTC, latence p99 8.4s',
  }),
  analyste: JSON.stringify({
    rootCause:
      'Le deploiement v2.14.3 a introduit un pool de connexions PostgreSQL limite a 5 connexions (regression de configuration), provoquant une saturation immediate sous charge nominale.',
    confidence: 88,
    secondaryCauses: [
      'Absence de test de charge sur l\'environnement de staging',
      'Alerte de saturation du pool non configuree dans CloudMonitor',
    ],
    alternatives: [
      'Panne reseau intermittente entre la zone A et la base de donnees (peu probable: les metriques reseau sont nominales)',
    ],
    summary: 'Regression de configuration du pool de connexions DB introduite par le deploiement v2.14.3.',
  }),
  operateur: JSON.stringify({
    plan: '1. Rollback immediat du service api-paiements vers la version v2.14.2\n2. Redemarrage du service pour purger les connexions zombies\n3. Verification du taux d\'erreur pendant 10 minutes\n4. Post-mortem: corriger la configuration du pool et ajouter un test de charge en CI',
    actions: [
      { tool: 'rollback_deployment', args: { service: 'api-paiements', version: 'v2.14.2' }, rationale: 'La v2.14.3 contient la regression du pool de connexions' },
      { tool: 'restart_service', args: { service: 'api-paiements' }, rationale: 'Purger les connexions DB zombies accumulees' },
    ],
    risk: 'moyen',
    rollbackPlan: 'En cas d\'echec du rollback: basculer le trafic vers la region secondaire eu-central-1 via le load balancer.',
    estimatedDowntime: '2-4 minutes pendant le rollback',
  }),
  rapporteur: [
    '# Rapport Post-Incident — INC (SentinelOps Society)',
    '',
    '## 1. Resume executif',
    'Incident critique P1 sur api-paiements cause par une regression de configuration du pool de connexions DB (deploiement v2.14.3). Remediation par rollback vers v2.14.2 apres validation humaine. Duree totale: 41 minutes.',
    '',
    '## 2. Chronologie',
    '- 12:02 UTC — Premiere alerte CloudMonitor (taux 5xx > 40%)',
    '- 12:03 UTC — Classification P1 par Le Sentinelle',
    '- 12:05 UTC — Investigation outillee par L\'Inspecteur (logs, metriques, deploiements)',
    '- 12:08 UTC — Cause racine identifiee par L\'Analyste (confiance 88%)',
    '- 12:10 UTC — Plan de remediation soumis a approbation DSI',
    '- 12:38 UTC — Approbation DSI recue, execution du rollback',
    '- 12:43 UTC — Service restaure, taux d\'erreur nominal',
    '',
    '## 3. Cause racine',
    'Pool de connexions PostgreSQL limite a 5 connexions dans la configuration de la v2.14.3 (valeur attendue: 50).',
    '',
    '## 4. Actions de remediation',
    '- Rollback api-paiements v2.14.3 -> v2.14.2 (execute)',
    '- Redemarrage du service (execute)',
    '',
    '## 5. Mesures preventives',
    '- Ajouter la validation de configuration du pool en CI',
    '- Test de charge obligatoire avant deploiement production',
    '- Alerte CloudMonitor sur la saturation du pool de connexions',
    '',
    '## 6. Conformite RGPD',
    'Aucune donnee personnelle exposee (indisponibilite uniquement). Notification CNIL: non requise.',
    '',
    '## 7. Notification ANSSI / NIS2',
    'Service essentiel au sens NIS2: OUI. Incident significatif (Art. 23): OUI — alerte precoce sous 24h transmise, notification complete sous 72h planifiee.',
    '',
    '## 8. Indicateurs',
    '- MTTD: 1 min — MTTR: 41 min — Disponibilite impactee: 0.09% du mois',
  ].join('\n'),
  inspecteur_summary: JSON.stringify({
    logsAnalysis:
      'Les logs montrent une explosion de "FATAL: remaining connection slots are reserved" et des timeouts de pool ("connection pool exhausted, waited 5000ms") demarrant 90 secondes apres le deploiement de v2.14.3.',
    recentDeployments: 'v2.14.3 deployee a 12:00 UTC (2 min avant la premiere alerte). Precedente: v2.14.2 (stable 6 jours).',
    impactedServices: ['api-paiements', 'checkout-web', 'facturation-batch'],
    findings:
      'Correlation temporelle forte entre le deploiement v2.14.3 et la saturation du pool de connexions PostgreSQL. Les metriques montrent 5 connexions actives max (vs 50 habituellement) et une file d\'attente en croissance exponentielle.',
  }),
};

export function getMock(agentKey: string): string {
  return MOCKS[agentKey] ?? '{}';
}
