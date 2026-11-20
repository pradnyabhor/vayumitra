import {
  AskVayuRequest,
  AskVayuResponse,
  MythCheckRequest,
  MythCheckResponse,
  DraftAdvisoryRequest,
  DraftAdvisoryResponse,
  DraftComplaintRequest,
  DraftComplaintResponse,
  CoarsenedFactsPayload,
} from "shared";

/**
 * Interface Segregation Principle (ISP) Port: AiClient
 * Decouples the application and routing layer from specific GenAI vendors (e.g. Vertex AI Gemini).
 */
export interface AiClient {
  askVayu(request: AskVayuRequest, facts: CoarsenedFactsPayload): Promise<AskVayuResponse>;
  askSaans?(request: AskVayuRequest, facts: CoarsenedFactsPayload): Promise<AskVayuResponse>;
  mythCheck(request: MythCheckRequest): Promise<MythCheckResponse>;
  draftAdvisory(request: DraftAdvisoryRequest): Promise<DraftAdvisoryResponse>;
  draftComplaint(request: DraftComplaintRequest): Promise<DraftComplaintResponse>;
}
