/**
 * quantclass-client
 * Copyright (c) 2025 量化小讲堂
 *
 * Licensed under the Business Source License 1.1 (BUSL-1.1).
 * Additional Use Grant: None
 * Change Date: 2028-08-22 | Change License: GPL-3.0-or-later
 * See the LICENSE file and https://mariadb.com/bsl11/
 */

import { updateProduct } from "@/main/core/product.js"
import {
	setAutoTrading,
	setAutoUpdate,
	systemState,
} from "@/main/lib/scheduler.js"
import store from "@/main/store/index.js"
import logger from "@/main/utils/wiston.js"
import { sql } from "drizzle-orm"
import type { Context } from "hono"
import { productStatus } from "../schema/index.js"
import type { ColumnInfo, Env } from "../types/index.js"

type IncrementalUpdateBody = {
	product?: unknown
	name?: unknown
}

type AutoUpdateBody = {
	enabled?: unknown
	isOn?: unknown
}

async function getOptionalJson<T>(c: Context<Env>): Promise<T | null> {
	if (c.req.raw.body === null) return null

	try {
		return (await c.req.json()) as T
	} catch {
		return null
	}
}

function incrementalUpdateStatusCode(
	status: "success" | "busy" | "error",
): 200 | 409 | 500 {
	if (status === "success") return 200
	if (status === "busy") return 409
	return 500
}

async function getSubscribedProducts(): Promise<string[]> {
	return (await store.getValue("settings.data_white_list", [])) as string[]
}

export async function getProductStatus(c: Context<Env>) {
	const db = c.var.db

	if (!db) {
		logger.error("数据库连接失败")
		return c.json({
			code: 500,
			message: "数据库连接失败",
			data: [],
		})
	}

	try {
		const dat = db.all<ColumnInfo>("PRAGMA table_info(product_status)")

		if (!dat.some((item) => item.name === "ts")) {
			logger.info("缺少ts列，正在添加")
			db.run(sql`ALTER TABLE product_status ADD COLUMN ts TEXT`)
		}

		const rawData = db.select().from(productStatus).all()

		const data = rawData.map((item) => ({
			name: item.name,
			displayName: item.displayName,
			fullData: item.full_data,
			lastUpdateTime: item.last_update_time,
			nextUpdateTime: item.next_update_time,
			dataTime: item.data_time,
			dataContentTime: item.data_content_time,
			isAutoUpdate: item.is_auto_update,
			canAutoUpdate: item.can_auto_update,
			addTime: item.add_time,
			isListed: item.is_listed,
			fullDataDownloadUrl: item.full_data_download_url,
			fullDataDownloadExpires: item.full_data_download_expires,
			ts: item.ts ?? "",
		}))

		const data_white_list = await getSubscribedProducts()

		const filteredData = data.filter((item) =>
			data_white_list.includes(item.name ?? ""),
		)

		return c.json({
			code: 200,
			message: "success",
			data: filteredData,
		})
	} catch (error) {
		logger.error(`查询产品状态失败: ${error}`)
		return c.json({
			code: 500,
			message: "查询产品状态失败",
			data: [],
		})
	}
}

/** POST /product/incremental-update */
export async function incrementalUpdate(c: Context<Env>) {
	const body = await getOptionalJson<IncrementalUpdateBody>(c)
	if (body === null && c.req.raw.body !== null) {
		return c.json({ code: 400, message: "请求体必须是有效的 JSON" }, 400)
	}

	const productValue = body?.product ?? body?.name
	if (productValue !== undefined && typeof productValue !== "string") {
		return c.json({ code: 400, message: "product 必须是字符串" }, 400)
	}

	const product = productValue?.trim()
	if (product === "") {
		return c.json({ code: 400, message: "product 不能为空" }, 400)
	}
	if (product && !(await getSubscribedProducts()).includes(product)) {
		return c.json({ code: 404, message: `未订阅数据产品：${product}` }, 404)
	}

	const result = await updateProduct(product)
	const status = incrementalUpdateStatusCode(result.status)
	return c.json(
		{
			code: status,
			message: result.message,
			data: { product: product ?? null, status: result.status },
		},
		status,
	)
}

/** GET /auto-update */
export function getAutoUpdateStatus(c: Context<Env>) {
	return c.json({
		code: 200,
		message: "success",
		data: { enabled: systemState.isSetAutoUpdate },
	})
}

/** POST /auto-update */
export async function setAutoUpdateStatus(c: Context<Env>) {
	const body = await getOptionalJson<AutoUpdateBody>(c)
	if (!body) {
		return c.json(
			{ code: 400, message: "请求体必须包含 enabled 布尔值" },
			400,
		)
	}

	const enabled = body.enabled ?? body.isOn
	if (typeof enabled !== "boolean") {
		return c.json(
			{ code: 400, message: "enabled 必须是布尔值" },
			400,
		)
	}

	try {
		await setAutoUpdate(enabled)
		if (systemState.isSetAutoUpdate !== enabled) {
			return c.json({ code: 503, message: "自动更新调度器启动失败" }, 503)
		}
		return c.json({
			code: 200,
			message: enabled ? "已开启订阅数据自动更新" : "已关闭订阅数据自动更新",
			data: { enabled: systemState.isSetAutoUpdate },
		})
	} catch (error) {
		logger.error(`设置订阅数据自动更新失败: ${error}`)
		return c.json({ code: 500, message: "设置订阅数据自动更新失败" }, 500)
	}
}

/** GET /auto-trading */
export function getAutoTradingStatus(c: Context<Env>) {
	return c.json({
		code: 200,
		message: "success",
		data: { enabled: systemState.isSetAutoTrading },
	})
}

/** POST /auto-trading */
export async function setAutoTradingStatus(c: Context<Env>) {
	const body = await getOptionalJson<AutoUpdateBody>(c)
	if (!body) {
		return c.json(
			{ code: 400, message: "请求体必须包含 enabled 布尔值" },
			400,
		)
	}

	const enabled = body.enabled ?? body.isOn
	if (typeof enabled !== "boolean") {
		return c.json(
			{ code: 400, message: "enabled 必须是布尔值" },
			400,
		)
	}

	try {
		const updated = await setAutoTrading(enabled)
		if (!updated || systemState.isSetAutoTrading !== enabled) {
			return c.json({ code: 503, message: "自动实盘调度器启动失败" }, 503)
		}
		return c.json({
			code: 200,
			message: enabled ? "已开启自动实盘" : "已关闭自动实盘",
			data: {
				enabled: systemState.isSetAutoTrading,
				autoUpdateEnabled: systemState.isSetAutoUpdate,
			},
		})
	} catch (error) {
		logger.error(`设置自动实盘失败: ${error}`)
		return c.json({ code: 500, message: "设置自动实盘失败" }, 500)
	}
}
