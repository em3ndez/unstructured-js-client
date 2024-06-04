/*
 * Code generated by Speakeasy (https://speakeasyapi.dev). DO NOT EDIT.
 */

import * as shared from "../shared";
import * as z from "zod";

export type PartitionRequest = {
    partitionParameters: shared.PartitionParameters;
    unstructuredApiKey?: string | null | undefined;
};

export type PartitionResponse = {
    /**
     * HTTP response content type for this operation
     */
    contentType: string;
    /**
     * Successful Response
     */
    elements?: Array<{ [k: string]: any }> | undefined;
    /**
     * HTTP response status code for this operation
     */
    statusCode: number;
    /**
     * Raw HTTP response; suitable for custom response parsing
     */
    rawResponse: Response;
};

/** @internal */
export namespace PartitionRequest$ {
    export const inboundSchema: z.ZodType<PartitionRequest, z.ZodTypeDef, unknown> = z
        .object({
            partition_parameters: shared.PartitionParameters$.inboundSchema,
            "unstructured-api-key": z.nullable(z.string()).optional(),
        })
        .transform((v) => {
            return {
                partitionParameters: v.partition_parameters,
                ...(v["unstructured-api-key"] === undefined
                    ? null
                    : { unstructuredApiKey: v["unstructured-api-key"] }),
            };
        });

    export type Outbound = {
        partition_parameters: shared.PartitionParameters$.Outbound;
        "unstructured-api-key"?: string | null | undefined;
    };

    export const outboundSchema: z.ZodType<Outbound, z.ZodTypeDef, PartitionRequest> = z
        .object({
            partitionParameters: shared.PartitionParameters$.outboundSchema,
            unstructuredApiKey: z.nullable(z.string()).optional(),
        })
        .transform((v) => {
            return {
                partition_parameters: v.partitionParameters,
                ...(v.unstructuredApiKey === undefined
                    ? null
                    : { "unstructured-api-key": v.unstructuredApiKey }),
            };
        });
}

/** @internal */
export namespace PartitionResponse$ {
    export const inboundSchema: z.ZodType<PartitionResponse, z.ZodTypeDef, unknown> = z
        .object({
            ContentType: z.string(),
            Elements: z.array(z.record(z.any())).optional(),
            StatusCode: z.number().int(),
            RawResponse: z.instanceof(Response),
        })
        .transform((v) => {
            return {
                contentType: v.ContentType,
                ...(v.Elements === undefined ? null : { elements: v.Elements }),
                statusCode: v.StatusCode,
                rawResponse: v.RawResponse,
            };
        });

    export type Outbound = {
        ContentType: string;
        Elements?: Array<{ [k: string]: any }> | undefined;
        StatusCode: number;
        RawResponse: never;
    };

    export const outboundSchema: z.ZodType<Outbound, z.ZodTypeDef, PartitionResponse> = z
        .object({
            contentType: z.string(),
            elements: z.array(z.record(z.any())).optional(),
            statusCode: z.number().int(),
            rawResponse: z.instanceof(Response).transform(() => {
                throw new Error("Response cannot be serialized");
            }),
        })
        .transform((v) => {
            return {
                ContentType: v.contentType,
                ...(v.elements === undefined ? null : { Elements: v.elements }),
                StatusCode: v.statusCode,
                RawResponse: v.rawResponse,
            };
        });
}
