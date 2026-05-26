'use server';

import twilio from 'twilio';

export interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  isoCountry: string;
}

export interface ProvisionedNumber {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
  voiceUrl: string;
  dateCreated: Date;
}

export interface ReputationResult {
  phoneNumber: string;
  isSpam: boolean;
  spamScore: number;
  lineType: string | null;
  callerName: string | null;
}

export interface SearchResult {
  numbers: AvailableNumber[];
  error?: string;
}

export interface ProvisionResult {
  success: boolean;
  number?: ProvisionedNumber;
  error?: string;
}

function getTwilioClient(): ReturnType<typeof twilio> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error(
      'Twilio credentials not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.',
    );
  }
  return twilio(accountSid, authToken);
}

export async function searchAvailableNumbers(areaCode: string): Promise<SearchResult> {
  if (!/^\d{3}$/.test(areaCode.trim())) {
    return { numbers: [], error: 'Area code must be exactly 3 digits.' };
  }
  try {
    const client = getTwilioClient();
    const results = await client.availablePhoneNumbers('US').local.list({
      areaCode: parseInt(areaCode, 10),
      limit: 10,
      voiceEnabled: true,
      smsEnabled: true,
    });
    const numbers: AvailableNumber[] = results.map((n) => ({
      phoneNumber: n.phoneNumber,
      friendlyName: n.friendlyName,
      locality: n.locality ?? null,
      region: n.region ?? null,
      postalCode: n.postalCode ?? null,
      isoCountry: n.isoCountry,
    }));
    return { numbers };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to search available numbers.';
    return { numbers: [], error: message };
  }
}

export async function provisionPhoneNumber(
  phoneNumber: string,
  contractorId: string,
): Promise<ProvisionResult> {
  if (!phoneNumber || !contractorId) {
    return { success: false, error: 'Phone number and contractor ID are required.' };
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const voiceWebhookUrl =
    process.env.TWILIO_VOICE_WEBHOOK_URL ?? `${appUrl}/api/webhooks/voice/inbound`;
  const statusCallbackUrl = `${appUrl}/api/webhooks/voice/status`;
  try {
    const client = getTwilioClient();
    const incoming = await client.incomingPhoneNumbers.create({
      phoneNumber,
      voiceUrl: voiceWebhookUrl,
      voiceMethod: 'POST',
      statusCallback: statusCallbackUrl,
      statusCallbackMethod: 'POST',
      friendlyName: `Receptionist-${contractorId}`,
    });
    const provisioned: ProvisionedNumber = {
      sid: incoming.sid,
      phoneNumber: incoming.phoneNumber,
      friendlyName: incoming.friendlyName ?? phoneNumber,
      voiceUrl: incoming.voiceUrl ?? voiceWebhookUrl,
      dateCreated: new Date(incoming.dateCreated),
    };
    return { success: true, number: provisioned };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to provision phone number.';
    return { success: false, error: message };
  }
}

export async function checkNumberReputation(phoneNumber: string): Promise<ReputationResult> {
  if (!phoneNumber) {
    throw new Error('Phone number is required for reputation check.');
  }
  try {
    const client = getTwilioClient();
    const lookup = await client.lookups.v2.phoneNumbers(phoneNumber).fetch({
      fields: 'line_type_intelligence,caller_name',
    });
    const lineTypeIntelligence = lookup.lineTypeIntelligence as Record<string, unknown> | null;
    const callerNameData = lookup.callerName as Record<string, unknown> | null;
    const lineType = lineTypeIntelligence
      ? String(lineTypeIntelligence['type'] ?? '')
      : null;
    const callerName = callerNameData
      ? String(callerNameData['caller_name'] ?? '')
      : null;
    const upperName = callerName?.toUpperCase() ?? '';
    const suspectLabel =
      upperName.includes('SCAM') ||
      upperName.includes('SPAM') ||
      upperName.includes('FRAUD') ||
      upperName.includes('TELEMARKETER');
    const spamScore = suspectLabel ? 0.9 : 0.1;
    return {
      phoneNumber,
      isSpam: spamScore >= 0.7,
      spamScore,
      lineType,
      callerName,
    };
  } catch {
    return {
      phoneNumber,
      isSpam: false,
      spamScore: 0,
      lineType: null,
      callerName: null,
    };
  }
}

export async function replaceSpammedNumber(
  currentSid: string,
  areaCode: string,
  contractorId: string,
): Promise<ProvisionResult> {
  if (!currentSid || !areaCode || !contractorId) {
    return {
      success: false,
      error: 'currentSid, areaCode, and contractorId are all required.',
    };
  }
  try {
    const client = getTwilioClient();
    await client.incomingPhoneNumbers(currentSid).remove();
    const searchResult = await searchAvailableNumbers(areaCode);
    if (searchResult.error || searchResult.numbers.length === 0) {
      return {
        success: false,
        error: searchResult.error ?? `No replacement numbers found for area code ${areaCode}.`,
      };
    }
    const replacement = searchResult.numbers[0];
    return provisionPhoneNumber(replacement.phoneNumber, contractorId);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to replace spam-labeled number.';
    return { success: false, error: message };
  }
}

export async function releasePhoneNumber(
  sid: string,
): Promise<{ success: boolean; error?: string }> {
  if (!sid) {
    return { success: false, error: 'Number SID is required.' };
  }
  try {
    const client = getTwilioClient();
    await client.incomingPhoneNumbers(sid).remove();
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to release phone number.';
    return { success: false, error: message };
  }
}
