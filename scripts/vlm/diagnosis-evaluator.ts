import fs from "fs";
import path from "path";
import { type DefectCategory, type DiagnosisResult } from "./diagnosis-schema";
import { type DiagnosisRunManifest } from "./diagnosis-service";

export interface ScenarioEvaluationResult {
  scenarioId: string;
  expectedDefectId: string;
  expectedCategory: string;
  expectedSymptom: string;
  diagnosedStatus: string;
  predictedCategory: DefectCategory | "none";
  predictedSeverity: string | "none";
  modelConfidence: number;
  categoryMatch: boolean;
  verdict: "correct" | "incorrect" | "inconclusive" | "error";
  modelSummary: string;
  notes: string[];
}

export interface EvaluationReport {
  runId: string;
  timestamp: string;
  provider: string;
  model: string;
  totalScenarios: number;
  successfullyDiagnosed: number;
  failedOrError: number;
  inconclusive: number;
  correctCategoryPredictions: number;
  incorrectCategoryPredictions: number;
  overallAccuracyPercent: number;
  categoryBreakdown: Record<
    string,
    {
      expectedCount: number;
      correctPredictions: number;
      accuracyPercent: number;
    }
  >;
  scenarioResults: ScenarioEvaluationResult[];
  averageConfidence: number;
  evaluationArtifactPath: string;
}

/**
 * Maps the internal defect category naming conventions to the strict diagnosis categories.
 */
function normalizeCategory(category: string): DefectCategory {
  const norm = category.toLowerCase().replace(/[-_]/g, "");
  if (norm.includes("visualdistortion") || norm.includes("imagedistortion")) return "image_distortion";
  if (norm.includes("layoutshift") || norm.includes("layoutbreakage")) return "layout_breakage";
  if (norm.includes("colorcontrast") || norm.includes("lowcontrast")) return "low_contrast";
  if (norm.includes("responsiveoverflow") || norm.includes("overflow")) return "responsive_overflow";
  return "unknown";
}

/**
 * Evaluates a completed diagnosis run against the saved ground_truth_eval.json record.
 * Operates purely locally and never feeds ground truth back to the VLM.
 */
export class DiagnosisEvaluator {
  public evaluate(
    diagnosisManifest: DiagnosisRunManifest,
    groundTruthData: any,
    outputDirectory?: string
  ): EvaluationReport {
    const scenarioResults: ScenarioEvaluationResult[] = [];
    const categoryBreakdown: Record<
      string,
      { expectedCount: number; correctPredictions: number; accuracyPercent: number }
    > = {};

    let correctCount = 0;
    let incorrectCount = 0;
    let inconclusiveCount = 0;
    let errorCount = 0;
    let totalConfidenceSum = 0;

    const scenarios = groundTruthData.scenarios || {};
    const totalScenarios = Object.keys(scenarios).length;

    for (const [scenarioId, gt] of Object.entries<any>(scenarios)) {
      const expectedCat = normalizeCategory(gt.expectedCategory);

      if (!categoryBreakdown[expectedCat]) {
        categoryBreakdown[expectedCat] = { expectedCount: 0, correctPredictions: 0, accuracyPercent: 0 };
      }
      categoryBreakdown[expectedCat].expectedCount++;

      const diagResult: DiagnosisResult | undefined = diagnosisManifest.results[scenarioId];

      if (!diagResult) {
        scenarioResults.push({
          scenarioId,
          expectedDefectId: gt.defectId,
          expectedCategory: gt.expectedCategory,
          expectedSymptom: gt.expectedSymptom,
          diagnosedStatus: "missing",
          predictedCategory: "none",
          predictedSeverity: "none",
          modelConfidence: 0,
          categoryMatch: false,
          verdict: "error",
          modelSummary: "Scenario was not found in diagnosis manifest.",
          notes: ["Missing diagnosis result."],
        });
        errorCount++;
        continue;
      }

      if (diagResult.status === "error") {
        scenarioResults.push({
          scenarioId,
          expectedDefectId: gt.defectId,
          expectedCategory: gt.expectedCategory,
          expectedSymptom: gt.expectedSymptom,
          diagnosedStatus: "error",
          predictedCategory: "none",
          predictedSeverity: "none",
          modelConfidence: 0,
          categoryMatch: false,
          verdict: "error",
          modelSummary: diagResult.diagnosis?.summary || "Provider execution error",
          notes: [diagResult.error || "Error reported by diagnosis pipeline"],
        });
        errorCount++;
        continue;
      }

      if (diagResult.status === "inconclusive" || diagResult.status === "no_defect_detected") {
        scenarioResults.push({
          scenarioId,
          expectedDefectId: gt.defectId,
          expectedCategory: gt.expectedCategory,
          expectedSymptom: gt.expectedSymptom,
          diagnosedStatus: diagResult.status,
          predictedCategory: "none",
          predictedSeverity: "none",
          modelConfidence: 0,
          categoryMatch: false,
          verdict: "inconclusive",
          modelSummary: diagResult.diagnosis?.summary || "Inconclusive diagnosis",
          notes: ["Model returned no defect or inconclusive."],
        });
        inconclusiveCount++;
        continue;
      }

      // Model returned 1 or more defects. Select primary defect (highest confidence)
      const defects = diagResult.diagnosis.defects || [];
      if (defects.length === 0) {
        scenarioResults.push({
          scenarioId,
          expectedDefectId: gt.defectId,
          expectedCategory: gt.expectedCategory,
          expectedSymptom: gt.expectedSymptom,
          diagnosedStatus: "diagnosed",
          predictedCategory: "none",
          predictedSeverity: "none",
          modelConfidence: 0,
          categoryMatch: false,
          verdict: "incorrect",
          modelSummary: diagResult.diagnosis.summary,
          notes: ["Diagnosed status with empty defects array."],
        });
        incorrectCount++;
        continue;
      }

      // Sort by confidence descending
      const primaryDefect = [...defects].sort((a, b) => b.confidence - a.confidence)[0];
      const predictedCat = primaryDefect.category;
      const isMatch = predictedCat === expectedCat;

      totalConfidenceSum += primaryDefect.confidence;

      if (isMatch) {
        correctCount++;
        categoryBreakdown[expectedCat].correctPredictions++;
      } else {
        incorrectCount++;
      }

      scenarioResults.push({
        scenarioId,
        expectedDefectId: gt.defectId,
        expectedCategory: gt.expectedCategory,
        expectedSymptom: gt.expectedSymptom,
        diagnosedStatus: diagResult.status,
        predictedCategory: predictedCat,
        predictedSeverity: primaryDefect.severity,
        modelConfidence: primaryDefect.confidence,
        categoryMatch: isMatch,
        verdict: isMatch ? "correct" : "incorrect",
        modelSummary: diagResult.diagnosis.summary,
        notes: [
          `Predicted category '${predictedCat}' compared to normalized expected '${expectedCat}'.`,
          `Confidence: ${(primaryDefect.confidence * 100).toFixed(1)}%.`,
        ],
      });
    }

    // Compute category percentages
    for (const cat of Object.keys(categoryBreakdown)) {
      const data = categoryBreakdown[cat];
      data.accuracyPercent = data.expectedCount > 0
        ? Number(((data.correctPredictions / data.expectedCount) * 100).toFixed(1))
        : 0;
    }

    const overallAccuracyPercent = totalScenarios > 0
      ? Number(((correctCount / totalScenarios) * 100).toFixed(1))
      : 0;

    const averageConfidence = correctCount + incorrectCount > 0
      ? Number((totalConfidenceSum / (correctCount + incorrectCount)).toFixed(2))
      : 0;

    const outDir = outputDirectory || diagnosisManifest.outputArtifactsDirectory;
    const reportPath = path.join(outDir, "evaluation-report.json");

    const report: EvaluationReport = {
      runId: diagnosisManifest.runId,
      timestamp: new Date().toISOString(),
      provider: diagnosisManifest.provider,
      model: diagnosisManifest.model,
      totalScenarios,
      successfullyDiagnosed: correctCount + incorrectCount,
      failedOrError: errorCount,
      inconclusive: inconclusiveCount,
      correctCategoryPredictions: correctCount,
      incorrectCategoryPredictions: incorrectCount,
      overallAccuracyPercent,
      categoryBreakdown,
      scenarioResults,
      averageConfidence,
      evaluationArtifactPath: reportPath,
    };

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
    return report;
  }
}
