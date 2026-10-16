// Protocol v2 row codec: the common row plus the per-category configuration.
// Categories live in one table (RowCodec.cpp) indexed by foreman::Category;
// adding one is a table entry here and a CATEGORY_SCHEMAS entry in the
// receiver's rows.mjs.
#pragma once
#include "Wire/JsonFields.h"
#include "Core/BridgeTypes.h"

namespace BridgeRows {
/** Strictly decode one row (event payload or snapshot line). */
bool RowFromJson(const BridgeJson::Object& Json, foreman::Row& Out);
BridgeJson::Object RowToJson(const foreman::Row& Row);
/** Outgoing guard: every string is valid UTF-8 and every number finite. */
bool ValidRow(const foreman::Row& Row);
}
