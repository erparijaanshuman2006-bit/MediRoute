/**
 * MediRoute — Emergency Priority & Triage Evaluation Module
 *
 * Categorizes incoming emergency requests into standardized response tiers
 * based on reported chief complaint and patient responsiveness.
 */

/**
 * Evaluates emergency type and patient condition against emergency dispatch triage rules.
 *
 * @param {string} emergencyType - e.g. "Chest Pain", "Breathing Difficulty", "Road Accident", "Serious Injury", "Other Emergency"
 * @param {string} patientCondition - e.g. "Unconscious", "Injured", "Conscious", "Unknown"
 * @returns {object} Triage result with priority level, code, color tier, and operational rationale.
 */
function evaluateTriage(emergencyType, patientCondition) {
  const type = String(emergencyType || "").trim();
  const condition = String(patientCondition || "").trim();

  // Tier 1: Immediate Critical Priority (P1)
  // Unconsciousness represents an immediate threat to airway, breathing, or circulation.
  if (condition.toLowerCase() === "unconscious") {
    return {
      priorityCode: "P1",
      priorityLevel: "P1 - Critical Priority",
      color: "critical",
      triageSummary:
        "Patient reported unconscious. Immediate threat to airway, breathing, or circulation requiring highest priority emergency dispatch.",
    };
  }

  // Chest pain represents acute coronary / thoracic risk.
  if (type.toLowerCase() === "chest pain") {
    return {
      priorityCode: "P1",
      priorityLevel: "P1 - Critical Priority",
      color: "critical",
      triageSummary:
        "Acute chest pain reported. Potential cardiac or thoracic emergency requiring immediate high-priority dispatch.",
    };
  }

  // Breathing difficulty carries rapid airway compromise risk.
  if (type.toLowerCase() === "breathing difficulty") {
    return {
      priorityCode: "P1",
      priorityLevel: "P1 - Critical Priority",
      color: "critical",
      triageSummary:
        "Acute respiratory distress reported. Compromised airway/ventilation requires immediate high-priority dispatch.",
    };
  }

  // Tier 2 (Provisional): Unconfirmed Patient Condition (P2)
  // Precautionary principle: Never downgrade unassessed patients to low priority.
  if (condition.toLowerCase() === "unknown" || !condition) {
    return {
      priorityCode: "P2",
      priorityLevel: "P2 - Urgent (Provisional)",
      color: "urgent",
      triageSummary:
        "Patient condition unconfirmed. Provisionally escalated to Urgent to ensure patient safety until on-scene triage by first responders.",
    };
  }

  // Tier 2: High-Energy Trauma or Severe Injury (P2)
  if (
    type.toLowerCase() === "road accident" ||
    type.toLowerCase() === "serious injury"
  ) {
    return {
      priorityCode: "P2",
      priorityLevel: "P2 - Urgent Priority",
      color: "urgent",
      triageSummary: `Significant trauma (${type}) reported with patient conscious/injured. Rapid stabilization and transport required.`,
    };
  }

  // Tier 3: Non-Acute / General Emergency (P3)
  if (type.toLowerCase() === "other emergency") {
    return {
      priorityCode: "P3",
      priorityLevel: "P3 - Standard Priority",
      color: "standard",
      triageSummary:
        "General emergency reported without acute airway, cardiac, or severe trauma indicators. Assigned to standard dispatch queue.",
    };
  }

  // Safe fallback for any unanticipated input
  return {
    priorityCode: "P2",
    priorityLevel: "P2 - Urgent (Provisional)",
    color: "urgent",
    triageSummary:
      "Unclassified emergency report. Provisionally routed to Urgent dispatch queue pending responder assessment.",
  };
}

module.exports = {
  evaluateTriage,
};
