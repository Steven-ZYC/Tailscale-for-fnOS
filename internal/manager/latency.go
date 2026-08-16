package manager

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

type netcheckReport struct {
	UDP           bool                       `json:"UDP"`
	IPv4          bool                       `json:"IPv4"`
	IPv6          bool                       `json:"IPv6"`
	PreferredDERP int                        `json:"PreferredDERP"`
	RegionLatency map[string]json.RawMessage `json:"RegionLatency"`
}

type RegionLatency struct {
	RegionID  int     `json:"region_id"`
	MS        float64 `json:"ms"`
	Preferred bool    `json:"preferred"`
}

type latencyResponse struct {
	PreferredDERP int             `json:"preferred_derp"`
	NearestMS     float64         `json:"nearest_ms"`
	UDP           bool            `json:"udp"`
	IPv4          bool            `json:"ipv4"`
	IPv6          bool            `json:"ipv6"`
	Regions       []RegionLatency `json:"regions"`
	MeasuredAt    string          `json:"measured_at"`
}

func (s *Server) handleLatency(writer http.ResponseWriter, request *http.Request) {
	ctx, cancel := context.WithTimeout(request.Context(), 18*time.Second)
	defer cancel()
	result, runErr := s.runner.Run(ctx, "netcheck", "--format=json")
	if runErr != nil {
		writeError(writer, http.StatusBadGateway, "netcheck_failed", commandMessage(result, runErr))
		return
	}
	var report netcheckReport
	if err := json.Unmarshal(result.Stdout, &report); err != nil {
		writeError(writer, http.StatusBadGateway, "netcheck_invalid", "无法解析 Tailscale 网络检测结果")
		return
	}
	response := latencyResponse{
		PreferredDERP: report.PreferredDERP,
		UDP:           report.UDP,
		IPv4:          report.IPv4,
		IPv6:          report.IPv6,
		MeasuredAt:    time.Now().UTC().Format(time.RFC3339),
	}
	for idText, raw := range report.RegionLatency {
		id, err := strconv.Atoi(idText)
		if err != nil {
			continue
		}
		milliseconds, err := durationMilliseconds(raw)
		if err != nil || milliseconds <= 0 {
			continue
		}
		response.Regions = append(response.Regions, RegionLatency{
			RegionID:  id,
			MS:        roundOne(milliseconds),
			Preferred: id == report.PreferredDERP,
		})
	}
	sort.Slice(response.Regions, func(i, j int) bool { return response.Regions[i].MS < response.Regions[j].MS })
	if len(response.Regions) > 0 {
		response.NearestMS = response.Regions[0].MS
		for _, region := range response.Regions {
			if region.Preferred {
				response.NearestMS = region.MS
				break
			}
		}
		if len(response.Regions) > 5 {
			response.Regions = response.Regions[:5]
		}
	}
	writeData(writer, http.StatusOK, response)
}

func durationMilliseconds(raw json.RawMessage) (float64, error) {
	text := strings.Trim(strings.TrimSpace(string(raw)), `"`)
	if text == "" || text == "null" {
		return 0, fmt.Errorf("empty duration")
	}
	if duration, err := time.ParseDuration(text); err == nil {
		return float64(duration) / float64(time.Millisecond), nil
	}
	nanoseconds, err := strconv.ParseFloat(text, 64)
	if err != nil {
		return 0, err
	}
	return nanoseconds / float64(time.Millisecond), nil
}

func roundOne(value float64) float64 {
	return math.Round(value*10) / 10
}
