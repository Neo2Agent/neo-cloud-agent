package cloud.neorun.loop.api;

import java.io.IOException;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import cloud.neorun.loop.config.LoopProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Shared-token check on the HTTP API. {@code /health} and the tools WebSocket (checked in its
 * handler) are exempt.
 *
 * @author neo-cloud-agent
 * @date 2026-09-04
 */
@Component
@Order(1)
public class TokenFilter extends OncePerRequestFilter {
  private static final String BEARER_PREFIX = "Bearer ";
  private static final String HEALTH_PATH = "/health";
  private static final String TOOLS_PATH_PREFIX = "/internal/tools/";
  private static final String TOKEN_PARAM = "token";

  private final LoopProperties properties;

  public TokenFilter(LoopProperties properties) {
    this.properties = properties;
  }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    String path = request.getRequestURI();
    return HEALTH_PATH.equals(path) || path.startsWith(TOOLS_PATH_PREFIX);
  }

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
      throws ServletException, IOException {
    String header = request.getHeader("Authorization");
    String presented = "";
    if (header != null && header.regionMatches(true, 0, BEARER_PREFIX, 0, BEARER_PREFIX.length())) {
      presented = header.substring(BEARER_PREFIX.length()).trim();
    }
    if (presented.isEmpty()) {
      presented = request.getParameter(TOKEN_PARAM);
    }
    if (!properties.tokenMatches(presented)) {
      response.sendError(HttpServletResponse.SC_UNAUTHORIZED, "invalid neo-loop token");
      return;
    }
    filterChain.doFilter(request, response);
  }
}
