import { PDFDocument } from "pdf-lib";
import async from "async";

import { HTTPClient } from "../../lib/http";
import {
  AfterErrorContext,
  AfterErrorHook,
  AfterSuccessContext,
  AfterSuccessHook,
  type BeforeRequestContext,
  BeforeRequestHook,
  SDKInitHook,
  SDKInitOptions,
} from "../types";
import { stringToBoolean } from "./utils";

const PARTITION_FORM_FILES_KEY = "files";
const PARTITION_FORM_SPLIT_PDF_PAGE_KEY = "split_pdf_page";
const MAX_NUMBER_OF_PARALLEL_REQUESTS = 15;

/**
 * Represents a hook for splitting and sending PDF files as per page requests.
 */
export class SplitPdfHook
  implements SDKInitHook, BeforeRequestHook, AfterSuccessHook, AfterErrorHook
{
  /**
   * The HTTP client used for making requests.
   */
  #client: HTTPClient | undefined;

  /**
   * Maps lists responses to client operation.
   */
  #partitionResponses: Record<string, Response[]> = {};

  /**
   * Maps parallel requests to client operation.
   */
  #partitionRequests: Record<string, Promise<unknown>> = {};

  /**
   * The maximum number of parallel operations allowed.
   * Max value is 15.
   */
  static parallelLimit = 5;

  /**
   * Initializes Split PDF Hook.
   * @param opts - The options for SDK initialization.
   * @returns The initialized SDK options.
   */
  sdkInit(opts: SDKInitOptions): SDKInitOptions {
    const { baseURL, client } = opts;
    this.#client = client;
    return { baseURL: baseURL, client: client };
  }

  /**
   * If `splitPdfPage` is set to `true` in the request, the PDF file is split into
   * separate pages. Each page is sent as a separate request in parallel. The last
   * page request is returned by this method. It will return the original request
   * when: `splitPdfPage` is set to `false`, the file is not a PDF, or the HTTP
   * has not been initialized.
   *
   * @param hookCtx - The hook context containing information about the operation.
   * @param request - The request object.
   * @returns If `splitPdfPage` is set to `true`, the last page request; otherwise,
   * the original request.
   */
  async beforeRequest(
    hookCtx: BeforeRequestContext,
    request: Request
  ): Promise<Request> {
    const { operationID } = hookCtx;
    const formData = await request.clone().formData();
    const splitPdfPage = stringToBoolean(
      (formData.get(PARTITION_FORM_SPLIT_PDF_PAGE_KEY) as string) ?? "false"
    );
    const file = formData.get(PARTITION_FORM_FILES_KEY) as File | null;

    if (!splitPdfPage) {
      return request;
    }

    if (!file?.name.endsWith(".pdf")) {
      console.warn("Given file is not a PDF. Continuing without splitting.");
      return request;
    }

    if (!this.#client) {
      console.warn("HTTP client not accessible! Continuing without splitting.");
      return request;
    }

    const fileName = file.name.replace(".pdf", "");
    const pages = await this.#getPdfPages(file);
    const headers = this.#prepareRequestHeaders(request);

    const requests: Request[] = [];
    for (const [i, page] of pages.entries()) {
      const body = await this.#prepareRequestBody(request);
      body.append(PARTITION_FORM_FILES_KEY, page, `${fileName}-${i + 1}.pdf`);
      const req = new Request(request.clone(), {
        headers,
        body,
      });
      requests.push(req);
    }

    if (SplitPdfHook.parallelLimit > MAX_NUMBER_OF_PARALLEL_REQUESTS) {
      console.warn(
        `'parallelLimit' was set to '${SplitPdfHook.parallelLimit}'. Max number of parallel request can't be higher then '${MAX_NUMBER_OF_PARALLEL_REQUESTS}'. Using the maximum value instead.`
      );
    }
    const parallelLimit =
      SplitPdfHook.parallelLimit > MAX_NUMBER_OF_PARALLEL_REQUESTS
        ? MAX_NUMBER_OF_PARALLEL_REQUESTS
        : SplitPdfHook.parallelLimit;

    this.#partitionResponses[operationID] = new Array(requests.length);

    this.#partitionRequests[operationID] = async.parallelLimit(
      requests.slice(0, -1).map((req, i) => async () => {
        try {
          const response = await this.#client!.request(req);
          if (response.status === 200) {
            (this.#partitionResponses[operationID] as Response[])[i] = response;
          }
        } catch (e) {
          console.error(`Failed to send request for page ${i + 1}.`);
        }
      }),
      parallelLimit
    );

    return requests.at(-1) as Request;
  }

  /**
   * Executes after a successful API request. Awaits all parallel requests and combines
   * the responses into a single response object.
   * @param hookCtx - The context object containing information about the hook execution.
   * @param response - The response object returned from the API request.
   * @returns If requests were run in parallel, a combined response object; otherwise,
   * the original response.
   */
  async afterSuccess(
    hookCtx: AfterSuccessContext,
    response: Response
  ): Promise<Response> {
    const { operationID } = hookCtx;
    const responses = await this.#awaitAllRequests(operationID);

    if (!responses) {
      return response;
    }

    const headers = this.#prepareResponseHeaders(response);
    const body = await this.#prepareResponseBody([...responses, response]);

    this.#clearOperation(operationID);

    return new Response(body, {
      headers: headers,
      status: response.status,
      statusText: response.statusText,
    });
  }

  /**
   * Executes after an unsuccessful API request. Awaits all parallel requests, if at least one
   * request was successful, combines the responses into a single response object and doesn't
   * throw an error. It will return an error only if all requests failed, or there was no PDF split.
   * @param hookCtx - The AfterErrorContext object containing information about the hook context.
   * @param response - The Response object representing the response received before the error occurred.
   * @param error - The error object that was thrown.
   * @returns If requests were run in parallel, and at least one was successful, a combined response
   * object; otherwise, the original response and error.
   */
  async afterError(
    hookCtx: AfterErrorContext,
    response: Response | null,
    error: unknown
  ): Promise<{ response: Response | null; error: unknown }> {
    const { operationID } = hookCtx;
    const responses = await this.#awaitAllRequests(operationID);

    if (!responses?.length) {
      this.#clearOperation(operationID);
      return { response, error };
    }

    const okResponse = responses[0] as Response;
    const headers = this.#prepareResponseHeaders(okResponse);
    const body = await this.#prepareResponseBody(responses);

    const finalResponse = new Response(body, {
      headers: headers,
      status: okResponse.status,
      statusText: okResponse.statusText,
    });

    this.#clearOperation(operationID);

    return { response: finalResponse, error: null };
  }

  /**
   * Converts a page of a PDF document to a Blob object.
   * @param pdf - The PDF document.
   * @param pageIndex - The index of the page to convert.
   * @returns A Promise that resolves to a Blob object representing the converted page.
   */
  async #pdfPageToBlob(pdf: PDFDocument, pageIndex: number): Promise<Blob> {
    const subPdf = await PDFDocument.create();
    const [page] = await subPdf.copyPages(pdf, [pageIndex]);
    subPdf.addPage(page);
    const subPdfBytes = await subPdf.save();
    return new Blob([subPdfBytes], {
      type: "application/pdf",
    });
  }

  /**
   * Retrieves an array of individual page files from a PDF file.
   *
   * @param file - The PDF file to extract pages from.
   * @returns A promise that resolves to an array of Blob objects, each representing
   * an individual page of the PDF.
   */
  async #getPdfPages(file: File | Blob): Promise<Blob[]> {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await PDFDocument.load(arrayBuffer);

    const pagesFiles: Blob[] = [];
    for (let i = 0; i < pdf.getPages().length; ++i) {
      const pageFile = await this.#pdfPageToBlob(pdf, i);
      pagesFiles.push(pageFile);
    }

    return pagesFiles;
  }

  /**
   * Removes the "content-length" header from the passed response headers.
   *
   * @param response - The response object.
   * @returns The modified headers object.
   */
  #prepareResponseHeaders(response: Response): Headers {
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return headers;
  }

  /**
   * Prepares the response body by extracting and flattening the JSON elements from
   * an array of responses.
   *
   * @param responses - An array of Response objects.
   * @returns A Promise that resolves to a string representation of the flattened
   * JSON elements.
   */
  async #prepareResponseBody(responses: Response[]): Promise<string> {
    const allElements: any[] = [];
    for (const res of responses) {
      const resElements = await res.clone().json();
      allElements.push(resElements);
    }
    return JSON.stringify(allElements.flat());
  }

  /**
   * Removes the "content-type" header from the given request headers.
   *
   * @param request - The request object containing the headers.
   * @returns The modified headers object.
   */
  #prepareRequestHeaders(request: Request): Headers {
    const headers = new Headers(request.headers);
    headers.delete("content-type");
    return headers;
  }

  /**
   * Prepares the request body for splitted PDF pages.
   *
   * @param request - The request object.
   * @returns A promise that resolves to a FormData object representing
   * the prepared request body.
   */
  async #prepareRequestBody(request: Request): Promise<FormData> {
    const formData = await request.clone().formData();
    formData.delete(PARTITION_FORM_SPLIT_PDF_PAGE_KEY);
    formData.delete(PARTITION_FORM_FILES_KEY);
    formData.append(PARTITION_FORM_SPLIT_PDF_PAGE_KEY, "false");
    return formData;
  }

  /**
   * Clears the parallel requests and response data associated with the given
   * operation ID.
   *
   * @param operationID - The ID of the operation to clear.
   */
  #clearOperation(operationID: string) {
    delete this.#partitionResponses[operationID];
    delete this.#partitionRequests[operationID];
  }

  /**
   * Awaits all parallel requests for a given operation ID and returns the
   * responses.
   * @param operationID - The ID of the operation.
   * @returns A promise that resolves to an array of responses, or undefined
   * if there are no requests for the given operation ID.
   */
  async #awaitAllRequests(
    operationID: string
  ): Promise<Response[] | undefined> {
    const requests = this.#partitionRequests[operationID];

    if (!requests) {
      return;
    }

    await requests;

    return this.#partitionResponses[operationID]?.filter((e) => e) ?? [];
  }
}